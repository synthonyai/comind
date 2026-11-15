// lib/comind/agentRuntime/dataFetcher.ts

import type { AgentContextData, FrameData, LensItem, SeenEntry } from '@/lib/comind/agentRuntime/types';
import { recallEntriesAndArtifacts } from '@/lib/comind/contextRecall';
import { loadFrame, loadInheritedFrames, loadRootFrame, type Frame } from '@/lib/comind/continuity';
import type { RecallDeps } from '@/lib/comind/intentions';
import type { MemoryStore } from '@/lib/comind/providers';
import type { Goal, GoverningItem, MemoryEntry } from '@/lib/comind/types';

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

/** Outranking items first, then by priority (stable for ties). */
export function rankItems(items: GoverningItem[]): LensItem[] {
    return [...items]
        .sort((a, b) => Number(b.outranks) - Number(a.outranks) || b.priority - a.priority)
        .map(({ id, text, priority, outranks }) => ({ id, text, priority, outranks }));
}

/**
 * Shape one governing frame for the prompt. Every list: outranking first, then
 * by priority. `titles` resolves a goal's `supports` ids to titles (goals from
 * every frame the turn sees); ids it can't resolve are left out.
 */
export function frameData({ agent, context, goals }: Frame, titles: Map<string, string> = new Map()): FrameData {
    return {
        // Only the core AgentProfile fields drive the cognitive prompt. Styling
        // (tone, formality…) is the host's concern.
        agentProfile: agent ? {
            name: agent.name || '',
            description: agent.description || '',
            directives: rankItems(agent.directives || []),
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
            watchWords: rankItems(context.watchWords || []),
        } : null,
        goals: [...goals]
            .sort((a, b) => Number(b.outranks) - Number(a.outranks) || b.weight - a.weight)
            .map(g => ({
                id: g.id, title: g.title, status: g.status, weight: g.weight,
                outranks: g.outranks ?? false,
                standing: g.standing ?? false,
                signs: { positive: g.signs?.positive ?? [], negative: g.signs?.negative ?? [] },
                supports: (g.supports ?? []).flatMap(id => titles.has(id) ? [{ id, title: titles.get(id)! }] : []),
            })),
    };
}

/** Goal id → title, across frames (resolves `supports`). */
export function goalTitles(frames: (Frame | null)[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const f of frames) for (const g of (f?.goals ?? []) as Goal[]) map.set(g.id, g.title);
    return map;
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

    const [frame, root, inherited, recall, recent, focus] = await Promise.all([
        // Governing/foreground frames via the same loaders `wake()` uses, so the
        // guide and the continuity packet never drift.
        loadFrame(store, contextId),
        loadRootFrame(store, contextId),
        loadInheritedFrames(store, contextId),
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

    const titles = goalTitles([frame, root, ...inherited]);
    return {
        ...frameData(frame, titles),
        root: root ? { contextId: root.contextId, ...frameData(root, titles) } : null,
        inherited: inherited.map(f => ({ contextId: f.contextId, name: f.context?.name ?? null, ...frameData(f, titles) })),
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
