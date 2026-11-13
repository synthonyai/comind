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
export type { RecallExplanation, RecallSignal, MatchedTerm, IntentionSource, IntentionSettings, KindWeights } from "@/lib/comind/intentions";
// The default order between kinds of governing memory (override via `createComind({ intention })`).
export { DEFAULT_KIND_WEIGHTS } from "@/lib/comind/intentions";

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
  ContextPatch,
  NewAgentProfile,
  AgentProfilePatch,
  GoverningItemInput,
  NewGoverningItem,
  GoverningItemPatch,
  NewGoverningSuggestion,
  NewMemoryLink,
  MemoryLinkFilters,
  LLMJob,
  LibraryJob,
  ChatMessage,
} from "@/lib/comind/providers";

// The mind's drafts of governing memory (`draftGoverning`) and what they're about.
export type { GoverningDraft, DraftSubject } from "@/lib/comind/governance";

// Normalise a governing-item seed (plain string or full input) — for custom stores.
export { governingInput } from "@/lib/comind/providers";
export type { GoverningItemSeed } from "@/lib/comind/providers";

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
  GoverningItem,
  GoverningKind,
  GoverningSuggestion,
  MemoryLink,
  ArtifactSourceLink,
  MemoryType,
  MemoryArtifactType,
  AttributionType,
  GoalStatus,
} from "@/lib/comind/types";

// --- Agent runtime: a guide turn as two steps (`reply` streamed, then
//     `extract`), what the guide was given, and the decision trace of a full
//     `runAgent` turn (inspectability + provenance). ---
export { extractionSchema } from "@/lib/comind/agentRuntime/types";
export type {
  ExtractionOutput,
  ExtractionResult,
  TurnOptions,
  GuideInput,
  ReplyTurn,
  TurnLens,
  FrameLens,
  LensItem,
  SeenEntry,
  SeenArtifact,
  RunAgentResult,
  DecisionTrace,
} from "@/lib/comind/agentRuntime/types";
