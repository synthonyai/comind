// lib/comind/governance.ts
//
// The mind's part in governing memory. Governing memory (goals, values, watch
// words, directives) belongs to the person: the mind never changes it on its
// own. What it can do:
//
//   - `draftGoverning`      — read what the person said (a setup conversation, a
//                             description…) and DRAFT goals, values and watch
//                             words (`drafting` job). Drafts are returned, not
//                             stored: the host shows them for approval, and may
//                             keep undecided ones as suggestions.
//   - suggestions           — proposed changes waiting for the person's OK;
//                             approving applies them with the normal verbs.
//   - `updateContextSummary` — write the mind's OWN understanding of a context
//                             (`Context.summary`, `summary` job). This is the
//                             mind's, not governing memory, so it updates freely.

import { z } from 'zod';
import type { LLMProvider, MemoryStore } from '@/lib/comind/providers';
import type { Context, GoverningSuggestion } from '@/lib/comind/types';
import { loadFrame, type Frame } from '@/lib/comind/continuity';

const bullets = (xs: string[]) => (xs.length ? xs.map(x => `- ${x}`).join('\n') : '- None');
const itemsOf = (f: Frame) => ({
    goals: f.goals.map(g => g.title),
    values: (f.context?.values ?? []).map(v => v.text),
    watchWords: (f.context?.watchWords ?? []).map(w => w.text),
});

// ---------------------------------------------------------------------------
// Drafting
// ---------------------------------------------------------------------------

const draftItem = z.object({
    text: z.string(),
    /** 0–1: 0.8 high, 0.5 normal, 0.2 low. */
    priority: z.number().min(0).max(1),
    why: z.string(),
});

export const draftSchema = z.object({
    goals: z.array(draftItem),
    values: z.array(draftItem),
    watchWords: z.array(draftItem),
});

export type GoverningDraft = z.infer<typeof draftSchema>;

/** What the drafting is about: a new or existing context, described by the person. */
export interface DraftSubject {
    name: string;
    seedIntent?: string | null;
    description?: string | null;
}

export async function draftGoverning(
    params: { about: DraftSubject; text: string; contextId?: string },
    deps: { store: MemoryStore; llm: LLMProvider }
): Promise<GoverningDraft> {
    const { store, llm } = deps;
    const rootId = await store.getRootContextId();
    const [root, existing] = await Promise.all([
        rootId && rootId !== params.contextId ? loadFrame(store, rootId) : null,
        params.contextId ? loadFrame(store, params.contextId) : null,
    ]);
    const r = root ? itemsOf(root) : null;
    const e = existing ? itemsOf(existing) : null;

    const prompt = `You help a person set up what they steer by in one area of their life.
From what they said, draft:
- GOALS — concrete things they want to achieve or keep doing here.
- VALUES — principles for how they want to go about it.
- WATCH WORDS — short words or phrases that, if they show up in the person's entries,
  suggest they're drifting from these goals or values (e.g. "skipped", "too tired").

# The area
Name: ${params.about.name}
Intent: ${params.about.seedIntent || 'Not given'}
Description: ${params.about.description || 'Not given'}
${r ? `
# Already set for their whole life (applies everywhere — do NOT repeat these)
Goals:\n${bullets(r.goals)}
Values:\n${bullets(r.values)}
Watch words:\n${bullets(r.watchWords)}
` : ''}${e ? `
# Already set for this area (do NOT repeat these)
Goals:\n${bullets(e.goals)}
Values:\n${bullets(e.values)}
Watch words:\n${bullets(e.watchWords)}
` : ''}
# What they said
${params.text}

# Rules
- Use their own words where you can. Keep each item short (one line).
- Only draft what they actually said or clearly implied — no generic filler.
- Usually 1–4 goals, 1–4 values, 2–6 watch words; fewer is fine.
- priority: 0.8 when they stressed it, 0.2 when it's a nice-to-have, otherwise 0.5.
- why: one short sentence pointing to what they said.`;

    const draft = await llm.generateStructured({ job: 'drafting', prompt, schema: draftSchema, temperature: 0.3 });
    return draft;
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

/**
 * Apply an approved suggestion with the normal verbs, then mark it approved.
 * The person may edit it while approving (editing = approving, in their words).
 * `outranks` is the host's call — the library never makes an item outrank.
 */
export async function approveSuggestion(
    id: string,
    edits: { text?: string; priority?: number; outranks?: boolean } | undefined,
    store: MemoryStore
): Promise<GoverningSuggestion> {
    const s = await store.getSuggestion(id);
    if (!s) throw new Error(`Suggestion ${id} not found`);
    if (s.status !== 'pending') throw new Error(`Suggestion ${id} is already ${s.status}`);
    const text = edits?.text ?? s.text;
    const priority = edits?.priority ?? s.priority;
    const outranks = edits?.outranks ?? false;
    if (s.kind === 'goal') {
        await store.createGoal({ contextId: s.contextId, title: text, weight: priority, outranks });
    } else {
        await store.createGoverningItem({ contextId: s.contextId, kind: s.kind, text, priority, outranks });
    }
    return store.setSuggestionStatus(id, 'approved');
}

// ---------------------------------------------------------------------------
// The mind's understanding of a context
// ---------------------------------------------------------------------------

export async function updateContextSummary(
    params: { contextId: string; seed?: string },
    deps: { store: MemoryStore; llm: LLMProvider }
): Promise<Context> {
    const { store, llm } = deps;
    const [frame, recent, promoted] = await Promise.all([
        loadFrame(store, params.contextId),
        store.listMemoryEntries({ contextId: params.contextId, limit: 20 }),
        store.listPromotedArtifacts(params.contextId, 0.6, 10),
    ]);
    if (!frame.context) throw new Error(`Context ${params.contextId} not found`);
    const c = frame.context;
    const i = itemsOf(frame);

    const prompt = `You are the memory of an AI companion. Write your own short understanding of
one area of a person's life — what it really is for them, what drives it, and the
patterns you've noticed. This is YOUR view, shown beside the person's own description.

# The area: ${c.name}
Intent: ${c.seedIntent || 'Not given'}
Their description: ${c.description || 'Not given'}
Goals:\n${bullets(i.goals)}
Values:\n${bullets(i.values)}
${c.summary ? `\n# Your previous understanding\n${c.summary}\n` : ''}${params.seed ? `\n# What they told you while setting it up\n${params.seed}\n` : ''}
# Their recent entries (newest first)
${recent.length ? recent.map(e => `- (${e.timestamp.toISOString().slice(0, 10)}) ${e.content.slice(0, 400)}`).join('\n') : '- None yet'}

# Settled beliefs about this area
${bullets(promoted.map(a => a.content))}

# Rules
- 2–4 sentences, plain text, second person ("you…"). Warm, specific, no flattery.
- Lasting understanding, not a log of recent events. Change it slowly: keep what still
  holds from your previous understanding, adjust what the entries have shown.
- Don't repeat their description back; add what you understand beyond it.
- If there is too little to go on, say so in one sentence.`;

    const out = await llm.generateStructured({
        job: 'summary',
        prompt,
        schema: z.object({ summary: z.string() }),
        temperature: 0.3,
    });
    return store.updateContext(params.contextId, { summary: out.summary.trim() });
}
