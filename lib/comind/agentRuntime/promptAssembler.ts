// lib/comind/agentRuntime/promptAssembler.ts
//
// The two prompts of a guide turn:
//   - `assembleGuidePrompt`      → the `reply` job: a system prompt + the
//                                  conversation as chat messages. Free text.
//   - `assembleExtractionPrompt` → the `extraction` job: reads the finished
//                                  exchange and fills `extractionSchema`.
//
// Wording stays neutral about HOW a host wants its guide to behave (tone, how to
// handle a clash…). Hosts express that through the agent profile's directives —
// the root context's directives apply in every context.

import type { AgentContextData, FrameData, FrameLens, GuideInput, LensItem, SeenArtifact, SeenEntry } from '@/lib/comind/agentRuntime/types';
import type { ChatMessage } from '@/lib/comind/providers';

const CONTENT_CAP = 300;
const clip = (s: string, n = CONTENT_CAP) => {
    const t = s.trim();
    return t.length > n ? `${t.slice(0, n)}…` : t;
};
const bullets = (items: string[], empty = '- None') =>
    items.length ? items.map(i => `- ${i}`).join('\n') : empty;

/** A governing item's label: outranking items say so; clear high/low priority is named. */
const tag = (outranks: boolean, priority: number) =>
    outranks ? ' (comes first)' : priority >= 0.75 ? ' (high priority)' : priority <= 0.25 ? ' (low priority)' : '';
const items = (list: LensItem[], empty?: string) =>
    bullets(list.map(i => `${i.text}${tag(i.outranks, i.priority)}`), empty);
/**
 * A goal line: its title, tags, whether it's ongoing (a standing value — no
 * finish line), what it serves, then its signs on indented lines.
 */
const goalLine = (g: FrameData['goals'][number]) => {
    const head = `${g.title}${tag(g.outranks, g.weight)}${g.standing ? ' (ongoing)' : ''}` +
        (g.supports.length ? ` — serves: ${g.supports.map(x => x.title).join('; ')}` : '');
    const signs = [
        g.signs.positive.length ? `\n  · when it's lived: ${g.signs.positive.join('; ')}` : '',
        g.signs.negative.length ? `\n  · when it's drifting: ${g.signs.negative.join('; ')}` : '',
    ].join('');
    return head + signs;
};
const goalItems = (goals: FrameData['goals'], empty?: string) => bullets(goals.map(goalLine), empty);
const GOALS_HEADING = '## Goals & values (highest priority first)';
const ONGOING_NOTE = '"(ongoing)" marks a standing value with no finish line: never ask whether it is done or call it stalled.';

/** Items marked as outranking in a frame — named up front so the model can't miss them. */
const outranking = (d: FrameData) => [
    ...d.goals.filter(g => g.outranks).map(g => g.title),
    ...(d.context?.watchWords ?? []).filter(i => i.outranks).map(i => i.text),
    ...(d.agentProfile?.directives ?? []).filter(i => i.outranks).map(i => i.text),
];
const OUTRANKS_NOTE = 'Items marked "(comes first)" outrank everything else: where anything pulls against them, they win.';

/** The root context block — governing memory that applies in every context. */
function rootBlock(root: AgentContextData['root']): string {
    if (!root) return '';
    const ctx = root.context;
    const lines: string[] = [
        '# Root Context — applies in every context and comes first',
        'This is the standing direction behind every context. It takes precedence over',
        "this context's own goals and values where they pull in different directions.",
    ];
    if (ctx?.seedIntent) lines.push('', `Intent: ${ctx.seedIntent}`);
    if (ctx?.whyItMatters) lines.push(`Why it matters: ${ctx.whyItMatters}`);
    if (outranking(root).length) lines.push(OUTRANKS_NOTE);
    if (root.goals.length) lines.push('', GOALS_HEADING, goalItems(root.goals));
    if (ctx?.constraints.length) lines.push('', '## Constraints', bullets(ctx.constraints));
    if (root.agentProfile?.directives.length) lines.push('', '## Instructions (apply in every context)', items(root.agentProfile.directives));
    if (ctx?.watchWords.length) lines.push('', '## Watch Words', items(ctx.watchWords));
    return lines.join('\n') + '\n\n';
}

/**
 * Frames inherited from the contexts between the root and this one, farthest
 * first: their goals and watch words apply here too, a little above this
 * context's own (their directives belong to their own guide and stay there).
 */
function inheritedBlock(inherited: AgentContextData['inherited']): string {
    return inherited.map(f => {
        const ctx = f.context;
        const lines: string[] = [
            `# From ${f.name || 'a wider context'} — the wider context this one sits in`,
            "Its direction applies here too and weighs a little above this context's own.",
        ];
        if (ctx?.seedIntent) lines.push('', `Intent: ${ctx.seedIntent}`);
        if (outranking({ ...f, agentProfile: null }).length) lines.push(OUTRANKS_NOTE);
        if (f.goals.length) lines.push('', GOALS_HEADING, goalItems(f.goals));
        if (ctx?.constraints.length) lines.push('', '## Constraints', bullets(ctx.constraints));
        if (ctx?.watchWords.length) lines.push('', '## Watch Words', items(ctx.watchWords));
        return lines.join('\n') + '\n\n';
    }).join('');
}

/** This context's own frame. */
function frameBlock(data: FrameData): string {
    const { agentProfile, context, goals } = data;
    return `# This Context${outranking(data).length ? `\n${OUTRANKS_NOTE}` : ''}
- Intent: ${context?.seedIntent || 'Not defined'}
- Why it matters: ${context?.whyItMatters || 'Not defined'}
- Description: ${context?.description || 'Not defined'}
- Current direction: ${context?.direction || 'Not defined'}

${GOALS_HEADING}
${goalItems(goals, '- None set')}

## Constraints
${bullets(context?.constraints ?? [])}

## Instructions
${items(agentProfile?.directives ?? [])}

## Watch Words
${items(context?.watchWords ?? [])}`;
}

function memoryBlock(
    mem: { artifacts: SeenArtifact[]; relevant: SeenEntry[]; recent: SeenEntry[] },
    withIds: boolean
): string {
    const id = (x: { id: string }) => (withIds ? `[ID:${x.id}] ` : '');
    const date = (d: Date) => new Date(d).toISOString().slice(0, 10);
    const reflections = mem.artifacts.length
        ? mem.artifacts.map(a => `${id(a)}[${a.type}] (${date(a.createdAt)}, confidence ${Math.round(a.confidence * 100)}%) ${clip(a.content)}`).join('\n')
        : 'None found.';
    const relevant = mem.relevant.length
        ? mem.relevant.map(e => `${id(e)}(${date(e.timestamp)}) ${clip(e.content)}`).join('\n')
        : 'None found.';
    const recent = mem.recent.length
        ? mem.recent.map(e => `${id(e)}(${date(e.timestamp)}) ${clip(e.content)}`).join('\n')
        : 'None.';
    return `# Memory
## Past reflections (derived from earlier exchanges)
${reflections}

## Relevant memories (recalled for this message)
${relevant}

## Recent entries in this context
${recent}`;
}

/**
 * The `reply` job's prompt: who the guide is, the governing frames (root first),
 * the recalled memory, and the conversation as real chat messages.
 */
export function assembleGuidePrompt(
    data: AgentContextData,
    message: string,
    history: ChatMessage[],
    instructions: string[] = []
): { system: string; messages: ChatMessage[] } {
    const name = data.agentProfile?.name || 'Guide';
    const role = data.agentProfile?.description || 'A thoughtful guide for this context.';

    const system = `You are ${name}, the guide for this context. ${role}
You have a long-term memory of this person's entries and past conversations; use it
naturally — refer back to what matters, don't recite it.

${instructions.length ? `# How to work\n${bullets(instructions)}\n\n` : ''}${ONGOING_NOTE}

${rootBlock(data.root)}${inheritedBlock(data.inherited)}${frameBlock(data)}

${memoryBlock({ artifacts: data.artifacts, relevant: data.intentionWeighted, recent: data.recentContext }, false)}

Reply in plain conversational text.`;

    return { system, messages: [...history, { role: 'user', content: message }] };
}

const transcript = (history: ChatMessage[], message: string, response: string) =>
    [...history, { role: 'user' as const, content: message }, { role: 'assistant' as const, content: response }]
        .map(m => `${m.role === 'user' ? 'Person' : 'Guide'}: ${m.content}`)
        .join('\n\n');

const focusBlock = (focus: SeenEntry[]) =>
    focus.length
        ? `# The entries this exchange is about\n${focus.map(e => `[ID:${e.id}] ${clip(e.content, 1200)}`).join('\n')}\n\n`
        : '';

/**
 * The `extraction` job's prompt: the memory critic reads the FINISHED exchange
 * (including the guide's reply) and distils durable meaning into typed artifacts.
 * Built from the turn's `GuideInput`, so it sees exactly what the guide saw.
 */
export function assembleExtractionPrompt(input: GuideInput, response: string): string {
    const goalLines = (goals: FrameLens['activeGoals']) =>
        goals.map(g => `- [ID:${g.id}] ${g.title} (weight ${g.weight}${g.standing ? ', ongoing' : ''})`);
    const root = input.lens.root;
    const allGoals = [
        ...goalLines(input.lens.activeGoals),
        ...input.lens.inherited.flatMap(f => goalLines(f.activeGoals)),
        ...(root ? goalLines(root.activeGoals) : []),
    ];
    const mem = { artifacts: input.recalled.artifacts, relevant: input.recalled.entries, recent: input.recent };

    return `You are the memory critic of an AI memory system. Read the exchange below and distil
any DURABLE meaning worth remembering into typed artifacts.

# Active Goals & values (this context${input.lens.inherited.length ? ', the contexts it sits in' : ''}${root ? ' and the root context' : ''})
${allGoals.length ? allGoals.join('\n') : '- None'}

${focusBlock(input.focus)}${memoryBlock(mem, true)}

# The exchange
${transcript(input.history, input.message, response)}

# Instructions
Artifact types:
- DECISION   — a choice that was made (and ideally why).
- INSIGHT    — a realization, pattern, or non-obvious conclusion.
- FACT       — a stable piece of information worth remembering.
- TASK       — something to be done / followed up on.
- QUESTION   — an open question to revisit later.
- CONSTRAINT — a limit, rule, or boundary to respect going forward.
- SUMMARY    — a condensed recap of a larger arc.

For each artifact give a concise 'content', an optional short 'title', a 'confidence'
(0–1), relevant 'tags', and 'sourceEntryIds' — the [ID:…]s of the entries it derives
from. When an artifact advances an active goal, add 'goalLinks' (the goal's [ID:…] as
'goalId', a 'strength' 0–1, a short 'rationale'); only link goals genuinely served.
1. Emit several artifacts when the exchange produced several distinct pieces of
   meaning; emit an EMPTY array when nothing genuinely new emerged. No filler.
2. Consider the whole conversation, not just the last message.
3. Don't repeat a past reflection unless the exchange changed or confirmed it.
4. In 'usedMemoryIds', list the [ID:…]s of the relevant memories and past reflections
   the Guide's reply actually drew on — what shaped what it said. Leave out anything
   that was recalled but played no part. Empty when the reply used none.
5. If the exchange relied heavily on specific recalled memories, list them in
   'updatesToRecalledMemories' with a boosted 'newImportanceScore'.`;
}
