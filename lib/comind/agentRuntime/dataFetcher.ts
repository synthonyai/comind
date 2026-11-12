// lib/comind/agentRuntime/dataFetcher.ts

import type { AgentContextData, FrameData, SeenEntry } from '@/lib/comind/agentRuntime/types';
import { recallEntriesAndArtifacts } from '@/lib/comind/contextRecall';
import { loadFrame, loadRootFrame, type Frame } from '@/lib/comind/continuity';
import type { RecallDeps } from '@/lib/comind/intentions';
import type { MemoryStore } from '@/lib/comind/providers';
import type { MemoryEntry } from '@/lib/comind/types';

/** How many recent entries a turn sees from its own context. */
const RECENT_LIMIT = 5;

// Carries the schema's belief signals (`confidence`, `attributionType`) through
// alongside the intention score — already hydrated on every entry.
function seenEntry(entry: MemoryEntry & { why?: SeenEntry['why'] }, intention = 0): SeenEntry {
    return {
        id: entry.id,
        content: entry.content,
        timestamp: entry.timestamp,
        intention,
        confidence: entry.confidence,
        attribution: entry.attributionType,
        ...(entry.why ? { why: entry.why } : {}),
    };
}

/** Shape one governing frame for the prompt. Goals: highest weight first. */
function frameData({ agent, context, goals }: Frame): FrameData {
    return {
        // Only the core AgentProfile fields drive the cognitive prompt. Styling
        // (tone, formality…) is the host's concern.
        agentProfile: agent ? {
            name: agent.name || '',
            description: agent.description || '',
            directives: agent.directives || [],
            watchWords: agent.watchWords || [],
        } : null,
        context: context ? {
            seedIntent: context.seedIntent || null,
            whyItMatters: context.whyItMatters || null,
            description: context.description || null,
            summary: context.summary || null,
            direction: context.direction || null,
            themes: context.themes || [],
            constraints: context.constraints || [],
            assumptions: context.assumptions || [],
            values: context.values || [],
        } : null,
        goals: [...goals]
            .sort((a, b) => b.weight - a.weight)
            .map(g => ({ id: g.id, title: g.title, status: g.status, weight: g.weight })),
    };
}

/**
 * Gather everything a guide turn is built from: this context's frame, the root
 * context's frame (applies everywhere), intention-weighted recall (with `why`),
 * recent entries, and the focus entries the turn is about.
 */
export async function getRecallData(params: {
    userId: string;
    contextId: string;
    message: string;
    focusEntryIds?: string[];
    deps: RecallDeps;
}): Promise<AgentContextData> {
    const { userId, contextId, message, deps } = params;
    const focusIds = new Set(params.focusEntryIds ?? []);

    // Everything routes through the injected store — the library ships no default backend.
    const store: MemoryStore | undefined = deps?.store;
    if (!store) throw new Error('CoMind: recall requires an injected MemoryStore (no default backend).');

    const [frame, root, recall, recent, focus] = await Promise.all([
        // Governing/foreground frames via the same loaders `wake()` uses, so the
        // guide and the continuity packet never drift.
        loadFrame(store, contextId),
        loadRootFrame(store, contextId),
        // Entries AND artifacts compete in one rerank. The pool is widened by the
        // number of focus entries, which are dropped below (they're likely the
        // closest match to the message — they are what it's about).
        recallEntriesAndArtifacts({
            userId, contextId, query: message, explain: true, deps,
            searchLimit: 8 + focusIds.size,
        }),
        store.listMemoryEntries({ contextId, limit: RECENT_LIMIT + focusIds.size }),
        Promise.all([...focusIds].map(id => store.getMemoryEntry(id))),
    ]);

    return {
        ...frameData(frame),
        root: root ? { contextId: root.contextId, ...frameData(root) } : null,
        intentionWeighted: recall.entries
            .filter(e => !focusIds.has(e.id))
            .map(e => seenEntry(e, e.intention)),
        artifacts: recall.artifacts.map(a => ({
            id: a.id, type: a.type, content: a.content, confidence: a.confidence,
            createdAt: a.createdAt, intention: a.intention,
            ...(a.why ? { why: a.why } : {}),
        })),
        recentContext: recent
            .filter(e => !focusIds.has(e.id))
            .slice(0, RECENT_LIMIT)
            .map(e => seenEntry(e)),
        focusEntries: focus.filter((e): e is MemoryEntry => !!e).map(e => seenEntry(e)),
    };
}
