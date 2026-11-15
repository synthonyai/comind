// lib/comind/agentRuntime/turn.ts
//
// A guide turn, as two separate steps the host sequences:
//
//   1. `reply`   — recall → assemble → stream the guide's answer (`reply` job).
//                  Returns what the guide was given (`GuideInput`) + the stream.
//   2. `extract` — after the reply, distil durable meaning from the exchange
//                  (`extraction` job) and write it back as artifacts.
//
// Keeping them apart lets a host stream replies, use a different model for
// each job, and decide WHEN extraction runs (every turn, end of session, never).
// `runAgent` is the convenience composition for hosts that don't stream.

import type {
    DecisionTrace, ExtractionOutput, ExtractionResult, GuideInput, ReplyTurn, RunAgentResult,
    TurnLens, TurnOptions, FrameData, SeenEntry,
} from '@/lib/comind/agentRuntime/types';
import { extractionSchema } from '@/lib/comind/agentRuntime/types';
import { assembleExtractionPrompt, assembleGuidePrompt } from '@/lib/comind/agentRuntime/promptAssembler';
import { getRecallData } from '@/lib/comind/agentRuntime/dataFetcher';
import { applyContextTokenBudget } from '@/lib/comind/agentRuntime/tokenBudget';
import type { EmbeddingProvider, LLMProvider, MemoryStore } from '@/lib/comind/providers';
import type { IntentionSettings } from '@/lib/comind/intentions';

export interface TurnDeps {
    store: MemoryStore;
    embeddings: EmbeddingProvider;
    llm: LLMProvider;
    intention?: IntentionSettings;
}

const preview = (s: string, n = 160) => s.slice(0, n);

function frameLens(f: FrameData) {
    return {
        seedIntent: f.context?.seedIntent ?? null,
        directives: f.agentProfile?.directives ?? [],
        watchWords: f.context?.watchWords ?? [],
        activeGoals: f.goals.filter(g => g.status === 'ACTIVE'),
    };
}

/**
 * Step 1 — the guide's reply. Recalls (with `why`), assembles the prompt (root
 * context first) and starts streaming the answer with the `reply` job.
 * Nothing is reinforced here: recall alone isn't use. `extract` reinforces the
 * memories the reply actually drew on.
 */
export async function reply(
    userId: string,
    contextId: string,
    message: string,
    opts: TurnOptions | undefined,
    deps: TurnDeps
): Promise<ReplyTurn> {
    const { store, embeddings, llm, intention } = deps;
    const history = opts?.history ?? [];

    const raw = await getRecallData({
        userId, contextId, message, focusEntryIds: opts?.focusEntryIds, deps: { store, embeddings, intention },
    });
    // Trim the recall-driven blocks BEFORE assembly, so the prompt, activation
    // and the returned input all reflect only what actually went in.
    const data = applyContextTokenBudget(raw, { maxTokens: opts?.tokenBudget });
    const prompt = assembleGuidePrompt(data, message, history, opts?.instructions);

    const lens: TurnLens = {
        ...frameLens(data),
        root: data.root ? { contextId: data.root.contextId, ...frameLens(data.root) } : null,
        inherited: data.inherited.map(f => ({ contextId: f.contextId, name: f.name, ...frameLens(f) })),
    };
    const input: GuideInput = {
        contextId,
        message,
        history,
        focus: data.focusEntries,
        prompt,
        lens,
        recalled: { entries: data.intentionWeighted, artifacts: data.artifacts },
        recent: data.recentContext,
    };

    const stream = llm.streamText({ job: 'reply', system: prompt.system, messages: prompt.messages, temperature: 0.7 });
    return { input, stream };
}

/**
 * Step 2 — extraction. Reads the finished exchange (what the guide was given +
 * its reply), distils typed artifacts with the `extraction` job, writes them
 * back with provenance and goal links, and reinforces the recalled memories the
 * reply drew on (the living loop).
 */
export async function extract(
    input: GuideInput,
    response: string,
    deps: TurnDeps
): Promise<ExtractionResult> {
    const { store, embeddings, llm } = deps;

    const critic = await llm.generateStructured({
        job: 'extraction',
        prompt: assembleExtractionPrompt(input, response),
        schema: extractionSchema,
        temperature: 0.1,
    }) as ExtractionOutput;
    // (`extractionSchema`'s `.default([])` makes its input type differ from its
    // output; generateStructured infers the input shape, so assert the output.)

    // Known ids the critic may cite; anything else is dropped from provenance.
    const known = new Set<string>([
        ...input.focus.map(e => e.id),
        ...input.recalled.entries.map(e => e.id),
        ...input.recent.map(e => e.id),
    ]);
    const fallbackSources = input.focus.length
        ? input.focus.map(e => e.id)
        : input.recalled.entries.map(e => e.id);

    const artifacts = await Promise.all(critic.artifacts.map(async a => {
        const cited = (a.sourceEntryIds ?? []).filter(id => known.has(id));
        const sourceEntryIds = cited.length ? cited : fallbackSources;
        const artifact = await store.createArtifact({
            contextId: input.contextId,
            type: a.type,
            content: a.content,
            title: a.title,
            confidence: a.confidence ?? 0.7,
            tags: a.tags ?? [],
            embedding: await embeddings.embed(a.content),
            sourceEntryIds,
            goalLinks: a.goalLinks,
        });
        return {
            id: artifact.id,
            type: artifact.type,
            title: a.title,
            preview: preview(artifact.content),
            sourceEntryIds,
            goalLinks: a.goalLinks ?? [],
        };
    }));

    // The critic's importance judgement on recalled memories it leaned on.
    const recalledIds = new Set(input.recalled.entries.map(e => e.id));
    const memoryUpdates = (critic.updatesToRecalledMemories ?? []).filter(u => recalledIds.has(u.id));
    await Promise.all(memoryUpdates.map(u =>
        store.updateMemoryEntry(u.id, { importanceScore: u.newImportanceScore })
    ));

    // The living loop: reinforce only the recalled memories the reply drew on.
    const used = new Set(critic.usedMemoryIds ?? []);
    const activated = {
        entryIds: input.recalled.entries.map(e => e.id).filter(id => used.has(id)),
        artifactIds: input.recalled.artifacts.map(a => a.id).filter(id => used.has(id)),
    };
    await Promise.all([
        store.activateEntries(activated.entryIds),
        store.activateArtifacts(activated.artifactIds),
    ]);

    return { artifacts, memoryUpdates, activated };
}

/** Collect a reply stream into one string. */
export async function collect(stream: AsyncIterable<string>): Promise<string> {
    let text = '';
    for await (const chunk of stream) text += chunk;
    return text;
}

const traceEntry = (e: SeenEntry) => ({
    id: e.id, preview: preview(e.content), intention: e.intention, confidence: e.confidence, attribution: e.attribution,
});

/**
 * A full turn without streaming: `reply` (collected) then `extract`. Returns the
 * response, the decision trace, and what the guide was given.
 */
export async function runAgent(
    userId: string,
    contextId: string,
    message: string,
    opts: TurnOptions | undefined,
    deps: TurnDeps
): Promise<RunAgentResult> {
    const turn = await reply(userId, contextId, message, opts, deps);
    const response = await collect(turn.stream);
    const produced = await extract(turn.input, response, deps);
    const { input } = turn;

    const trace: DecisionTrace = {
        lens: input.lens,
        recalled: {
            entries: input.recalled.entries.map(traceEntry),
            artifacts: input.recalled.artifacts.map(a => ({
                id: a.id, type: a.type, preview: preview(a.content), intention: a.intention, confidence: a.confidence,
            })),
        },
        produced,
        activated: produced.activated,
    };
    return { response, trace, input };
}
