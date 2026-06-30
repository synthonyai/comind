/**
 * CoMind provider interfaces — the three "cords" that connect the cognitive
 * layer to the outside world. A consumer embedding CoMind implements these to
 * plug in their own backend; the default implementations (Phase 3) wrap the
 * journaling app's current Prisma / HuggingFace / OpenAI code.
 *
 *   - MemoryStore       — where memories live and how to find them
 *   - EmbeddingProvider — turn text into a vector
 *   - LLMProvider       — fill a CoMind-owned schema from a prompt
 *
 * Phase 2 of V01_IMPLEMENTATION_PLAN.md — additive, INTERFACES ONLY. Nothing
 * implements or imports these yet; Phase 3 wraps the existing code behind them.
 *
 * Design notes:
 * - Scoping is `contextId`-only. "User"/tenant is the app's multi-tenancy
 *   concept, not a cognitive one — the store adapter handles any user scoping
 *   internally (e.g. the Prisma adapter keeps its `userId` filter under the
 *   hood). The library's vocabulary stays generic for non-app consumers.
 * - All methods speak in CoMind's own core types (see `./types`), never Prisma
 *   rows. The Prisma schema is one *mapping* of these types, done inside the
 *   adapter.
 * - `searchSimilar` takes a *vector*, not text: the store never embeds. The
 *   orchestration layer embeds the query (via EmbeddingProvider) and passes the
 *   vector in. This is what lets the store and embedder be swapped independently.
 * - Artifact / link / provenance store methods are intentionally NOT here yet.
 *   They are added to MemoryStore in their own phases (10 artifacts, 11
 *   provenance, 14 links) when their shape is actually understood.
 */

import type { z } from 'zod';
import type {
  MemoryEntry,
  MemoryArtifact,
  MemoryArtifactType,
  MemoryType,
  AttributionType,
  Context,
  AgentProfile,
  Goal,
  GoalStatus,
} from '@/lib/comind/types';

// ---------------------------------------------------------------------------
// MemoryStore — persistence + retrieval. "Store + find", nothing more.
// ---------------------------------------------------------------------------

/** Fields the orchestration layer supplies when creating a memory entry. */
export interface NewMemoryEntry {
  contextId: string;
  type: MemoryType;
  content: string;
  title?: string | null;
  subtype?: string | null;
  tags?: string[];

  /**
   * Pre-computed by the EmbeddingProvider in the orchestration layer. The store
   * persists it as-is; it does not embed. `null`/omitted means "not embedded".
   */
  embedding?: number[] | null;

  /** When the memory is considered to have happened. Defaults to now. */
  timestamp?: Date;

  importanceScore?: number;
  confidence?: number;
  attributionType?: AttributionType;
  derivedFromId?: string | null;

  sourceType?: string | null;
  sourceId?: string | null;
  sourceUri?: string | null;
}

/** Mutable fields on an existing memory entry. */
export interface MemoryEntryPatch {
  content?: string;
  title?: string | null;
  tags?: string[];
  /** Pass a fresh vector when content changed; store persists it atomically. */
  embedding?: number[] | null;
  importanceScore?: number;
  confidence?: number;
}

/** Plain (non-similarity) listing filters. */
export interface MemoryEntryFilters {
  contextId: string;
  tagsAny?: string[];
  limit?: number;
}

/** A vector similarity query. The store owns its own distance math. */
export interface SimilaritySearch {
  /** Query vector, already produced by the EmbeddingProvider. */
  vector: number[];
  contextId?: string | null;
  tagsAny?: string[];
  /** Candidate pool size (orchestration reranks + trims afterward). */
  limit?: number;
}

/** One nearest-neighbour result: the full entry plus its raw distance. */
export interface SimilarityHit {
  entry: MemoryEntry;
  /** Store-native distance (smaller = closer). Not comparable across stores. */
  distance: number;
}

/**
 * One nearest-neighbour artifact result: the full artifact, the entry ids it was
 * derived from (for prefer-artifact dedup), plus its raw distance. Artifacts ride
 * the same recall pipeline as entries (Bucket C / P2).
 */
export interface ArtifactSimilarityHit {
  artifact: MemoryArtifact;
  /** Source entries this artifact was distilled from (provenance). */
  sourceEntryIds: string[];
  /** Store-native distance (smaller = closer). Not comparable across stores. */
  distance: number;
}

/** Listing filter for goals. */
export interface GoalFilters {
  contextId: string;
  /** When set, only goals with this status (e.g. 'ACTIVE'). Omit for all. */
  status?: GoalStatus;
}

/** Fields supplied when creating a goal. */
export interface NewGoal {
  contextId: string;
  title: string;
  description?: string | null;
  status?: GoalStatus;
  weight?: number;
  order?: number | null;
  parentId?: string | null;
}

/**
 * Mutable fields on an existing goal — the goal *lifecycle* surface (#14): a goal
 * is the fast-changing sub-priority layer, so its status/weight/title/order can
 * move. Completing a goal (`status: 'COMPLETED'`) drops it from the ACTIVE set
 * `listGoals` feeds the intention lens, so the *same memory pile re-ranks* under
 * the surviving goals (#4/#13) — the lens shifts beneath a core that doesn't.
 *
 * Note (deliberate boundary): there is intentionally NO `updateContext` /
 * `updateAgentProfile`. The standing identity (seedIntent, values, directives,
 * watchWords) is the PERSISTENT core and is immutable in v0.1 by construction —
 * the absence of a setter is the guarantee that the core sticks. Identity
 * evolution arrives in v0.2 through the governed root-aligner path (root override
 * + misalignment detection + human control), never a raw setter. `parentId`
 * (goal reparenting) is also omitted: it's structural, not lifecycle, and goal
 * hierarchy isn't wired in v0.1.
 */
export interface GoalPatch {
  status?: GoalStatus;
  weight?: number;
  title?: string;
  description?: string | null;
  order?: number | null;
}

/**
 * Fields supplied when the memory critic creates a derived artifact (Bucket C).
 * Like entries, the embedding is PRE-COMPUTED by the orchestration layer (via the
 * EmbeddingProvider) and persisted as-is — the store never embeds.
 */
export interface NewArtifact {
  contextId: string;
  type: MemoryArtifactType;
  content: string;
  title?: string | null;
  confidence?: number;
  tags?: string[];
  embedding?: number[] | null;
  /** Source entries this artifact was distilled from (provenance / ArtifactSourceLink). */
  sourceEntryIds: string[];
  /** Goals this artifact serves; ids not in this context are dropped by the store. */
  goalLinks?: { goalId: string; strength?: number; rationale?: string }[];
}

/** Fields supplied when creating a new context. */
export interface NewContext {
  name: string;
  seedIntent?: string | null;
  whyItMatters?: string | null;
  direction?: string | null;
  description?: string | null;
  themes?: string[];
  constraints?: string[];
  assumptions?: string[];
  values?: string[];
  parentId?: string | null;
}

/** Fields supplied when creating a new agent profile. */
export interface NewAgentProfile {
  name?: string | null;
  homeContextId?: string | null;
  description?: string | null;
  directives?: string[];
  watchWords?: string[];
}

/**
 * Domain-level memory persistence. The cognitive layer never sees SQL; each
 * implementation does similarity its own way (pgvector `<->`, in-memory cosine,
 * a vector DB, …) behind `searchSimilar`.
 */
export interface MemoryStore {
  // --- Memory entries ---
  createMemoryEntry(input: NewMemoryEntry): Promise<MemoryEntry>;
  updateMemoryEntry(id: string, patch: MemoryEntryPatch): Promise<MemoryEntry>;
  getMemoryEntry(id: string): Promise<MemoryEntry | null>;
  listMemoryEntries(filters: MemoryEntryFilters): Promise<MemoryEntry[]>;

  /** Core retrieval primitive: nearest neighbours to a query vector. */
  searchSimilar(query: SimilaritySearch): Promise<SimilarityHit[]>;

  /**
   * Nearest-neighbour search over derived artifacts (Bucket C / P2). Same vector
   * math as `searchSimilar`; artifacts are context-scoped (no per-user filter).
   */
  searchSimilarArtifacts(query: SimilaritySearch): Promise<ArtifactSimilarityHit[]>;

  /** Fetch a derived artifact by id (used to hydrate reranked artifact rows). */
  getArtifact(id: string): Promise<MemoryArtifact | null>;

  /**
   * Create a derived artifact (Bucket C). Persists the pre-computed embedding,
   * records provenance (sourceEntryIds -> ArtifactSourceLink), and writes the
   * critic's goal links (dropping any goalId not in this context).
   */
  createArtifact(input: NewArtifact): Promise<MemoryArtifact>;

  // --- The living loop (activation feedback) ---
  // Implementations MUST apply the shared rule in lib/comind/activation.ts so
  // recall behaves consistently across backends. Returns the number of rows hit.

  /** Reinforce recalled memory entries that were used this turn. */
  activateEntries(ids: string[]): Promise<number>;
  /** Reinforce recalled artifacts that were used this turn (same rule as entries). */
  activateArtifacts(ids: string[]): Promise<number>;

  // --- Context, goals & agent profile (so the library is self-contained) ---
  createContext(input: NewContext): Promise<Context>;
  getContext(id: string): Promise<Context | null>;
  /** The root context for this store's scope (parentId === null). Null if none. */
  getRootContextId(): Promise<string | null>;
  createGoal(input: NewGoal): Promise<Goal>;
  /**
   * Patch a goal's lifecycle fields (status/weight/title/order). Completing a goal
   * removes it from the ACTIVE set the intention lens is built from, shifting recall
   * focus without touching the persistent identity core (#4/#13/#14).
   */
  updateGoal(id: string, patch: GoalPatch): Promise<Goal>;
  /** Goals for a context (intention weighting + goal-link validation). */
  listGoals(filters: GoalFilters): Promise<Goal[]>;
  createAgentProfile(input: NewAgentProfile): Promise<AgentProfile>;
  getAgentProfileForContext(contextId: string): Promise<AgentProfile | null>;
}

// ---------------------------------------------------------------------------
// EmbeddingProvider — text -> vector.
// ---------------------------------------------------------------------------

/**
 * Turns text into a semantic vector. The `embed` / `embedQuery` split is kept
 * deliberately: some models (e.g. bge) use different instruction prefixes for
 * stored documents vs. search queries, which affects recall quality.
 */
export interface EmbeddingProvider {
  /** Output dimension. The Phase 7 guardrail checks this against the store. */
  readonly dimensions: number;

  /** Embed text that will be stored as a memory/document. */
  embed(text: string): Promise<number[]>;

  /** Embed text that is being used as a search query. */
  embedQuery(text: string): Promise<number[]>;
}

// ---------------------------------------------------------------------------
// LLMProvider — generic structured output over a CoMind-owned schema.
// ---------------------------------------------------------------------------

/**
 * Produces structured output validated against a schema CoMind owns (the
 * provider just fills it). The concrete model (e.g. `gpt-4o`) lives inside the
 * implementation, not on this interface — swapping models means swapping the
 * provider, with no change to the cognitive layer.
 */
export interface LLMProvider {
  generateStructured<T>(params: {
    prompt: string;
    schema: z.ZodType<T>;
    temperature?: number;
  }): Promise<T>;
}
