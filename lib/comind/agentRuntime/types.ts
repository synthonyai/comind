// lib/agentRuntime/types.ts
import { z } from 'zod';
import type { AttributionType } from '@/lib/comind/types';

/**
 * Zod schema for the structured output from the external LLM.
 * This provides runtime validation.
 */
/** The seven first-class artifact types (mirrors prisma `MemoryArtifactType`). */
export const artifactTypeEnum = z.enum([
    'DECISION', 'INSIGHT', 'FACT', 'TASK', 'QUESTION', 'CONSTRAINT', 'SUMMARY',
]);

export const agentActionSchema = z.object({
    response: z.string(),
    memoryCritic: z.object({
        // 0..n typed artifacts the critic chooses to derive this turn. An empty
        // array means "nothing genuinely new emerged" (replaces isImportant:false).
        artifacts: z.array(z.object({
            type: artifactTypeEnum,
            content: z.string(),
            title: z.string().optional(),
            confidence: z.number().min(0).max(1).optional(),
            tags: z.array(z.string()).optional(),
            // Which recalled entries (by [ID:…]) this artifact derives from.
            // Omitted → falls back to all recalled entries at the call site.
            sourceEntryIds: z.array(z.string()).optional(),
            // Which goal(s) this artifact serves (by goal id shown in the prompt),
            // how strongly, and why — feeds goal-health. Invalid ids are dropped.
            goalLinks: z.array(z.object({
                goalId: z.string(),
                strength: z.number().min(0).max(1).optional(),
                rationale: z.string().optional(),
            })).optional(),
        })).default([]),
        updatesToRecalledMemories: z.array(z.object({
            id: z.string(),
            newImportanceScore: z.number().min(0).max(1),
        })).optional(),
    }),
});

/**
 * TypeScript type inferred from the Zod schema.
 * Use this for type annotations throughout your code.
 */
export type AgentActionOutput = z.infer<typeof agentActionSchema>;

export interface RunAgentContext {
    originalEntry: string
    chatHistory: Array<{ role: 'user' | 'assistant', content: string }>
}

/**
 * The decision trace (Bucket E / step 2 — inspectability #6 + provenance #10).
 * Makes a runAgent turn explainable: WHAT memory shaped the response (recalled),
 * WHAT the critic concluded and saved (produced), and WHICH memories were
 * reinforced (activated). The host can surface this to show "why it said that"
 * and "what it learned", without re-querying the store.
 */
export interface DecisionTrace {
    /**
     * The standing intention lens this turn was weighted against (inspectability
     * #8 + standing-identity #13). `seedIntent` + the identity (`values`,
     * `directives`, `watchWords`) are the PERSISTENT core — immutable in v0.1, so
     * they hold steady across resets and goal-lifecycle changes. `activeGoals` is
     * the shifting sub-focus: when a goal completes it leaves this set and recall
     * re-weights beneath an unchanged core (the #4/#13 focus-shift). Built from
     * data already fetched for the prompt — no extra store reads.
     */
    lens: {
        seedIntent: string | null;
        values: string[];
        directives: string[];
        watchWords: string[];
        /** Goals with status ACTIVE — the only part of the lens with a lifecycle. */
        activeGoals: { title: string; weight: number }[];
    };
    /**
     * What surfaced into the prompt and shaped the response. Each recalled item
     * carries the schema's belief signals so the host can show HOW SURE the mind
     * is (`confidence`, #11) and — for raw entries — whether it was TOLD this or
     * FIGURED IT OUT (`attribution`, #10). Artifacts carry no `attribution`: a
     * derived artifact has no `attributionType` column (schema) because it IS the
     * "figured out itself" side by construction — the host renders it as inferred.
     */
    recalled: {
        entries: { id: string; preview: string; intention: number; confidence: number; attribution: AttributionType }[];
        artifacts: { id: string; type: string; preview: string; intention: number; confidence: number }[];
    };
    /** What the memory critic derived and wrote back this turn. */
    produced: {
        artifacts: {
            id: string;
            type: string;
            title?: string;
            preview: string;
            /** Provenance (#10): the source entries this artifact derived from. */
            sourceEntryIds: string[];
            /** Goal-health links the critic requested (invalid ids are dropped on write). */
            goalLinks: { goalId: string; strength?: number; rationale?: string }[];
        }[];
        memoryUpdates: { id: string; newImportanceScore: number }[];
    };
    /** Operational-signal reinforcement (the living loop) applied this turn. */
    activated: { entryIds: string[]; artifactIds: string[] };
}

export interface RunAgentResult {
    response: string;
    trace: DecisionTrace;
}

/**
 * Interface representing the structured context data needed by the Agent Runtime.
 */
export interface AgentContextData {
    // Core AgentProfile fields only. App-layer styling (tone, formality,
    // detailLevel, referenceModels, …) is the host's concern and is no longer
    // part of the library's cognitive prompt.
    agentProfile: {
        name: string;
        description: string;
        directives: string[];
        watchWords: string[];
    } | null;
    context: {
        seedIntent: string | null;
        whyItMatters: string | null;
        description: string | null;
        summary: string | null;
        direction: string | null;
        themes: string[];
        constraints: string[];
        assumptions: string[];
        values: string[];
    } | null;
    goals: { id: string; title: string; status: string; weight: number }[];
    intentionWeighted: { id: string; content: string; intention: number; timestamp: Date; confidence: number; attribution: AttributionType }[];
    recentContext: { id: string; content: string; timestamp: Date; confidence: number; attribution: AttributionType }[];
    artifacts: { id: string; type: string; content: string; confidence: number; createdAt: Date; intention: number }[];
    userMessage: string;
    conversationContext?: RunAgentContext;
}