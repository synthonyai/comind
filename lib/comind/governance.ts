// lib/comind/governance.ts
//
// The mind's part in governing memory. Governing memory (goals — completable
// or standing —, watch words, directives) belongs to the person: the mind never
// changes it on its own. What it can do:
//
//   - `draftGoverning`      — read what the person said (a setup conversation, a
//                             description…) and DRAFT goals (with signs and the
//                             broader goals they support) and watch words, and
//                             optionally an intent line and sub-areas
//                             (`drafting` job). Drafts are returned, not
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
import { loadAncestorIds, loadFrame, type Frame } from '@/lib/comind/continuity';

const bullets = (xs: string[]) => (xs.length ? xs.map(x => `- ${x}`).join('\n') : '- None');
const goalText = (g: Frame['goals'][number]) => `${g.title}${g.standing ? ' (ongoing)' : ''}`;
const itemsOf = (f: Frame) => ({
    goals: f.goals.map(goalText),
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

const draftGoal = draftItem.extend({
    /** Ongoing, no finish line (a standing value) rather than something to complete. */
    standing: z.boolean(),
    /** Ids of broader goals (from the list given) this one clearly serves. */
    supports: z.array(z.string()).default([]),
    /** Concrete signs, mainly for abstract goals; empty otherwise. */
    signs: z.object({ positive: z.array(z.string()), negative: z.array(z.string()) })
        .default({ positive: [], negative: [] }),
});

export const draftSchema = z.object({
    /** Only when asked (`include.intent`): a one-line intent for the subject. */
    intent: z.string().nullable().default(null),
    goals: z.array(draftGoal),
    watchWords: z.array(draftItem),
    /** Only when asked (`include.children`): sub-areas the subject breaks into. */
    children: z.array(z.object({ name: z.string(), intent: z.string(), why: z.string() })).default([]),
});

export type GoverningDraft = z.infer<typeof draftSchema>;

/** What the drafting is about: a new or existing context, described by the person. */
export interface DraftSubject {
    name: string;
    seedIntent?: string | null;
    description?: string | null;
}

export async function draftGoverning(
    params: {
        about: DraftSubject;
        text: string;
        contextId?: string;
        /** The context the subject will sit under (for a new one) — its direction applies to it. */
        parentId?: string | null;
        /** Also draft a one-line intent (`intent`) and/or sub-areas (`children`). */
        include?: { intent?: boolean; children?: boolean };
    },
    deps: { store: MemoryStore; llm: LLMProvider }
): Promise<GoverningDraft> {
    const { store, llm } = deps;
    const rootId = await store.getRootContextId();
    // The contexts above the subject: an existing context's ancestors, or a new
    // one's intended parent and that parent's ancestors.
    const aboveIds = params.contextId
        ? await loadAncestorIds(store, params.contextId)
        : params.parentId && params.parentId !== rootId
            ? [...(await loadAncestorIds(store, params.parentId)), params.parentId]
            : [];
    const isRoot = !!rootId && params.contextId === rootId;
    const [root, above, existing] = await Promise.all([
        rootId && !isRoot ? loadFrame(store, rootId) : null,
        Promise.all(aboveIds.map(id => loadFrame(store, id))),
        params.contextId ? loadFrame(store, params.contextId) : null,
    ]);
    const r = root ? itemsOf(root) : null;
    const e = existing ? itemsOf(existing) : null;
    // Broader goals a drafted goal may support, with ids the model can cite.
    const broader = [...(root?.goals ?? []), ...above.flatMap(f => f.goals)];
    const known = new Set(broader.map(g => g.id));

    const prompt = `You help a person set up what they steer by in one area of their life.
From what they said, draft:
- GOALS & VALUES — what they want here. Mark each one:
  standing: true  — an ongoing value or commitment with no finish line ("eat at regular times",
                    "stabilized energy and internal coherence");
  standing: false — something they can complete ("run a spring 10k").
- SIGNS — for abstract or ongoing goals, a few concrete, observable signs in their words:
  positive = what it looks like when it's being lived, negative = when it's drifting.
  Leave both empty for concrete goals.
- SUPPORTS — for each goal, the ids of the broader goals listed below that it clearly serves
  (empty when none, or when no list is given).
- WATCH WORDS — short words or phrases that, if they show up in the person's entries,
  suggest they're drifting from these goals (e.g. "skipped", "too tired").${params.include?.intent ? `
- INTENT — one line, in their words, saying what this area is about for them.` : ''}${params.include?.children ? `
- CHILDREN — the main areas this breaks into, as they described them (name, a one-line
  intent in their words, why). Usually 2–6.` : ''}

# The area
Name: ${params.about.name}
Intent: ${params.about.seedIntent || 'Not given'}
Description: ${params.about.description || 'Not given'}
${r ? `
# Already set for their whole life (applies everywhere — do NOT repeat these)
Goals & values:\n${bullets(r.goals)}
Watch words:\n${bullets(r.watchWords)}
` : ''}${above.length ? `
# Already set for the wider area this sits in (applies here — do NOT repeat these)
Goals & values:\n${bullets(above.flatMap(f => f.goals.map(goalText)))}
` : ''}${e ? `
# Already set for this area (do NOT repeat these)
Goals & values:\n${bullets(e.goals)}
Watch words:\n${bullets(e.watchWords)}
` : ''}${broader.length ? `
# Broader goals a drafted goal may support (cite by id)
${broader.map(g => `- [ID:${g.id}] ${goalText(g)}`).join('\n')}
` : ''}
# What they said
${params.text}

# Rules
- Use their own words where you can. Keep each item short (one line).
- Only draft what they actually said or clearly implied — no generic filler.
- Usually 2–8 goals & values, 2–6 watch words; fewer is fine.
- priority: 0.8 when they stressed it, 0.2 when it's a nice-to-have, otherwise 0.5.
- why: one short sentence pointing to what they said.`;

    // (`.default()` makes the schema's input type differ from its output;
    // generateStructured infers the input shape, so assert the output.)
    const draft = await llm.generateStructured({ job: 'drafting', prompt, schema: draftSchema, temperature: 0.3 }) as GoverningDraft;
    // Only ids that exist; and nothing that wasn't asked for.
    return {
        intent: params.include?.intent ? draft.intent : null,
        goals: draft.goals.map(g => ({ ...g, supports: g.supports.filter(id => known.has(id)) })),
        watchWords: draft.watchWords,
        children: params.include?.children ? draft.children : [],
    };
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
    edits: { text?: string; priority?: number; outranks?: boolean; standing?: boolean; supports?: string[] } | undefined,
    store: MemoryStore
): Promise<GoverningSuggestion> {
    const s = await store.getSuggestion(id);
    if (!s) throw new Error(`Suggestion ${id} not found`);
    if (s.status !== 'pending') throw new Error(`Suggestion ${id} is already ${s.status}`);
    const text = edits?.text ?? s.text;
    const priority = edits?.priority ?? s.priority;
    const outranks = edits?.outranks ?? false;
    if (s.kind === 'goal') {
        await store.createGoal({
            contextId: s.contextId, title: text, weight: priority, outranks,
            standing: edits?.standing ?? s.standing ?? false,
            supports: edits?.supports ?? s.supports ?? [],
        });
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
Goals & values:\n${bullets(i.goals)}
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
