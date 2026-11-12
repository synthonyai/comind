// lib/comind/index.ts
//
// CoMind public contract (v0.1 frozen surface — Bucket E / step 5).
//
// This barrel exposes ONLY the consumer-facing surface. It deliberately does
// NOT re-export internal recall/memory primitives — so nothing heavy leaks
// through the barrel into consumer code (PRD success criterion #2; proven by
// demo:prove + demo/checkBarrelClean). The library ships no built-in backend: a
// consumer embeds CoMind by implementing the three provider interfaces below and
// passing them to `createComind(...)`.

// --- The entry point: the factory + its instance type. ---
export { createComind } from "@/lib/comind/createComind";
export type { Comind, CreateComindConfig } from "@/lib/comind/createComind";

// --- Recall result shapes returned by the standalone `recall()` verb: raw
//     entries and derived artifacts, each carrying its `intention` score. ---
export type { RecalledEntry, RecalledArtifact } from "@/lib/comind/contextRecall";
export type { RecallExplanation, RecallSignal, MatchedTerm, IntentionSource } from "@/lib/comind/intentions";

// --- The continuity assembler (v0.2 item B): the pure "wake" function and the
//     ContinuityState packet it returns. `comind.wake()` is the instance-method
//     shortcut; the standalone fn is for hosts/tests/the future engine. ---
export { assembleContinuityState } from "@/lib/comind/continuity";
export type { ContinuityState } from "@/lib/comind/continuity";

// --- Provider interfaces (implement these to plug in a custom backend) + their
//     input/output types. The default adapters are wired inside createComind. ---
export type {
  MemoryStore,
  EmbeddingProvider,
  LLMProvider,
  NewMemoryEntry,
  MemoryEntryPatch,
  MemoryEntryFilters,
  SimilaritySearch,
  SimilarityHit,
  ArtifactSimilarityHit,
  NewArtifact,
  NewGoal,
  GoalPatch,
  GoalFilters,
  NewContext,
  NewAgentProfile,
} from "@/lib/comind/providers";

// --- The activation reinforcement rule (the living loop). A custom MemoryStore
//     applies this in its activateEntries/activateArtifacts so recall behaves
//     consistently across backends. ---
export { ACTIVATION, nextActivation } from "@/lib/comind/activation";
export type { ActivationSignals, ActivatedSignals } from "@/lib/comind/activation";

// --- Capture-time importance seeding (v0.2 item E). The semantic goal-alignment
//     blend that seeds importanceScore at capture; `storeMemory` applies it, and
//     it's exported so a host can seed importance on its own writes too. ---
export { IMPORTANCE, seedImportanceScore, seedCaptureImportance, alignmentSimilarity } from "@/lib/comind/importance";
export type { AlignmentTarget } from "@/lib/comind/importance";

// --- Core domain types (plain TS; the Prisma schema is one mapping of these). ---
export type {
  MemoryEntry,
  MemoryArtifact,
  Context,
  AgentProfile,
  Goal,
  MemoryLink,
  ArtifactSourceLink,
  MemoryType,
  MemoryArtifactType,
  AttributionType,
  GoalStatus,
} from "@/lib/comind/types";

// --- Agent runtime: the structured-output schema, the conversation input, and
//     the decision trace returned by `runAgent` (inspectability + provenance). ---
export { agentActionSchema } from "@/lib/comind/agentRuntime/types";
export type {
  AgentActionOutput,
  RunAgentContext,
  RunAgentResult,
  DecisionTrace,
} from "@/lib/comind/agentRuntime/types";
