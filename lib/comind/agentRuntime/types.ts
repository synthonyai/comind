// lib/comind/agentRuntime/types.ts
import { z } from 'zod';
import type { AttributionType } from '@/lib/comind/types';
import type { ChatMessage } from '@/lib/comind/providers';
import type { RecallExplanation } from '@/lib/comind/intentions';

/** The seven first-class artifact types (mirrors the schema's `MemoryArtifactType`). */
export const artifactTypeEnum = z.enum([
    'DECISION', 'INSIGHT', 'FACT', 'TASK', 'QUESTION', 'CONSTRAINT', 'SUMMARY',
]);

/**
 * Structured output of the `extraction` job — the memory critic. It reads an
 * exchange AFTER the reply and distils its durable meaning.
 */
export const extractionSchema = z.object({
    // 0..n typed artifacts the critic chooses to derive. An empty array means
    // "nothing genuinely new emerged".
    artifacts: z.array(z.object({
        type: artifactTypeEnum,
        content: z.string(),
        title: z.string().optional(),
        confidence: z.number().min(0).max(1).optional(),
        tags: z.array(z.string()).optional(),
        // Which entries (by [ID:…]) this artifact derives from. Omitted → falls
        // back to the turn's focus entries, else all recalled entries.
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
});

/** The validated output of the `extraction` job. */
export type ExtractionOutput = z.infer<typeof extractionSchema>;

/** Options for a guide turn (`reply` / `runAgent`). */
export interface TurnOptions {
    /** The conversation so far, oldest first, NOT including the new message. */
    history?: ChatMessage[];
    /**
     * Entries this turn is about (e.g. a note the person just wrote and is now
     * discussing). They are kept out of recall and recent context — they are
     * already in the conversation — and are the default sources for anything
     * extraction derives.
     */
    focusEntryIds?: string[];
    /** Token budget for the recall-driven memory blocks (default 4000). */
    tokenBudget?: number;
    /**
     * The host application's standing instructions for the guide — its house
     * rules (tone, how to raise a clash, what never to do). Shown before the
     * governing frames, apart from what the person set in their contexts.
     */
    instructions?: string[];
}

/** The governing lens of one frame, as shown to the guide. */
export interface FrameLens {
    seedIntent: string | null;
    values: string[];
    directives: string[];
    watchWords: string[];
    /** Goals with status ACTIVE, highest weight first. */
    activeGoals: { id: string; title: string; weight: number }[];
}

/**
 * The governing lens a turn was weighted against (inspectability). `root` is
 * the root context's lens — it applies in every context and comes first; null
 * when there is no root or the turn's context IS the root.
 */
export interface TurnLens extends FrameLens {
    root: (FrameLens & { contextId: string }) | null;
}

/** A memory entry as the guide saw it. */
export interface SeenEntry {
    id: string;
    content: string;
    timestamp: Date;
    /** Intention-rerank score (0 for recent-context entries, which aren't ranked). */
    intention: number;
    confidence: number;
    attribution: AttributionType;
    /** Why it was recalled (score, signals, governing items that boosted it). */
    why?: RecallExplanation;
}

/** A recalled derived artifact as the guide saw it. */
export interface SeenArtifact {
    id: string;
    type: string;
    content: string;
    createdAt: Date;
    intention: number;
    confidence: number;
    why?: RecallExplanation;
}

/**
 * Everything the guide was given for one turn — the exact prompt plus the
 * memory that went into it. Returned by `reply` (so a host can show "what the
 * guide saw") and passed back to `extract`. Plain data: safe to store or log.
 */
export interface GuideInput {
    contextId: string;
    message: string;
    history: ChatMessage[];
    /** The entries this turn is about (`focusEntryIds`), kept out of recall. */
    focus: SeenEntry[];
    /** The exact system prompt and messages sent to the model. */
    prompt: { system: string; messages: ChatMessage[] };
    lens: TurnLens;
    /** Recalled by meaning + intention (after the token budget). */
    recalled: { entries: SeenEntry[]; artifacts: SeenArtifact[] };
    /** The most recent entries in this context (after the token budget). */
    recent: SeenEntry[];
}

/** A guide reply in progress: what it was given, and the streamed text. */
export interface ReplyTurn {
    input: GuideInput;
    /** The reply, chunk by chunk. Consume it once. */
    stream: AsyncIterable<string>;
}

/** What `extract` derived and wrote back. */
export interface ExtractionResult {
    artifacts: {
        id: string;
        type: string;
        title?: string;
        preview: string;
        /** Provenance: the source entries this artifact derived from. */
        sourceEntryIds: string[];
        /** Goal-health links the critic requested (invalid ids are dropped on write). */
        goalLinks: { goalId: string; strength?: number; rationale?: string }[];
    }[];
    memoryUpdates: { id: string; newImportanceScore: number }[];
}

/**
 * The decision trace of a full turn (`runAgent`): WHAT memory shaped the reply
 * (recalled), WHAT extraction concluded and saved (produced), and WHICH memories
 * were reinforced (activated).
 */
export interface DecisionTrace {
    lens: TurnLens;
    /**
     * What surfaced into the prompt. Raw entries carry `attribution` (was it
     * TOLD this or did it FIGURE IT OUT); derived artifacts are inferred by
     * construction.
     */
    recalled: {
        entries: { id: string; preview: string; intention: number; confidence: number; attribution: AttributionType }[];
        artifacts: { id: string; type: string; preview: string; intention: number; confidence: number }[];
    };
    produced: ExtractionResult;
    /** Operational-signal reinforcement (the living loop) applied this turn. */
    activated: { entryIds: string[]; artifactIds: string[] };
}

export interface RunAgentResult {
    response: string;
    trace: DecisionTrace;
    input: GuideInput;
}

// ---------------------------------------------------------------------------
// Internal: the assembled data a turn's prompts are built from.
// ---------------------------------------------------------------------------

/** One frame's governing data, as the prompt needs it. */
export interface FrameData {
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
}

/** The structured data a guide turn is assembled from (internal). */
export interface AgentContextData extends FrameData {
    /** The root context's frame — applies everywhere. Null when none / this IS the root. */
    root: (FrameData & { contextId: string }) | null;
    intentionWeighted: SeenEntry[];
    recentContext: SeenEntry[];
    artifacts: SeenArtifact[];
    /** The entries this turn is about (kept out of recall; shown to extraction). */
    focusEntries: SeenEntry[];
}
