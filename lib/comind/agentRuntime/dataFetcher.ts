// lib/agentRuntime/dataFetcher.ts

import { AgentContextData, RunAgentContext } from '@/lib/comind/agentRuntime/types';
import { recallEntriesAndArtifacts } from '@/lib/comind/contextRecall';
import type { RecallDeps } from '@/lib/comind/intentions';
import type { MemoryStore } from '@/lib/comind/providers';
import type { AttributionType } from '@/lib/comind/types';

// Carries the schema's belief signals (`confidence` #11, `attributionType` #10)
// through to the trace alongside the intention score — they're already hydrated
// on every recalled/recent entry, so this is a pass-through, not a new read.
function formatMemoryEntry(
    entry: { id: string; content: string; timestamp: Date; confidence: number; attributionType: AttributionType },
    intentionScore: number = 0
): { id: string; content: string; intention: number; timestamp: Date; confidence: number; attribution: AttributionType } {
    return {
        id: entry.id,
        content: entry.content,
        intention: intentionScore,
        timestamp: entry.timestamp,
        confidence: entry.confidence,
        attribution: entry.attributionType,
    };
}

export async function getRecallData(
    userId: string,
    contextId: string,
    userMessage: string,
    context?: RunAgentContext,
    deps?: RecallDeps
): Promise<AgentContextData> {

    // Everything routes through the injected store. The store is required — the
    // library ships no default backend (the host injects it, e.g. via createComind).
    const store: MemoryStore | undefined = deps?.store;
    if (!store) throw new Error('CoMind: recall requires an injected MemoryStore (no default backend).');

    // 1. Agent profile + 2. Context & active goals — via the store (core types).
    const [agent, contextData, goals] = await Promise.all([
        store.getAgentProfileForContext(contextId),
        store.getContext(contextId),
        store.listGoals({ contextId, status: 'ACTIVE' }),
    ]);

    // 3. Intention-weighted search — entries AND artifacts compete in one rerank
    //    (Bucket C / P2), hydrated and split by kind in the shared recall core
    //    (Bucket E / step 1). Runtime path consumes ALL survivors (no final cap).
    const { entries, artifacts } = await recallEntriesAndArtifacts({
        userId, contextId, query: userMessage, deps,
    });

    const intentionWeighted = entries.map((e) => formatMemoryEntry(e, e.intention));
    const artifactRecords = artifacts.map((a) => ({
        id: a.id, type: a.type, content: a.content, confidence: a.confidence, createdAt: a.createdAt, intention: a.intention,
    }));

    // 4. Recent context — most recent entries in this context.
    const recentContextEntries = await store.listMemoryEntries({ contextId, limit: 5 });
    const recentContext = recentContextEntries.map(entry => formatMemoryEntry(entry));

    return {
        // Only the core AgentProfile fields drive the cognitive prompt. App-layer
        // styling (tone/formality/detailLevel/etc.) is the host's concern and no
        // longer reaches the library prompt.
        agentProfile: agent ? {
            name: agent.name || '',
            description: agent.description || '',
            directives: agent.directives || [],
            watchWords: agent.watchWords || [],
        } : null,
        context: contextData ? {
            seedIntent: contextData.seedIntent || null,
            whyItMatters: contextData.whyItMatters || null,
            description: contextData.description || null,
            summary: contextData.summary || null,
            direction: contextData.direction || null,
            themes: contextData.themes || [],
            constraints: contextData.constraints || [],
            assumptions: contextData.assumptions || [],
            values: contextData.values || [],
        } : null,
        goals: goals.map(g => ({
            id: g.id,
            title: g.title,
            status: g.status,
            weight: g.weight,
        })),
        intentionWeighted,
        recentContext,
        artifacts: artifactRecords,
        userMessage,
        conversationContext: context
    };
}