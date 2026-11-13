/**
 * CoMind provider interfaces — the three "cords" that connect the cognitive
 * layer to the outside world. A host embedding CoMind implements these to plug
 * in its own backend:
 *
 *   - MemoryStore       — where memories live and how to find them
 *   - EmbeddingProvider — turn text into a vector
 *   - LLMProvider       — talk to a language model, one named job at a time
 *
 * Design notes:
 * - Scoping is `contextId`-only. "User"/tenant is the host's multi-tenancy
 *   concept, not a cognitive one — the store adapter handles any user scoping
 *   internally. The library's vocabulary stays generic.
 * - All methods speak in CoMind's own core types (see `./types`), never database
 *   rows. A database schema is one *mapping* of these types, done inside the
 *   adapter.
 * - `searchSimilar` takes a *vector*, not text: the store never embeds. The
 *   orchestration layer embeds the query (via EmbeddingProvider) and passes the
 *   vector in. This is what lets the store and embedder be swapped independently.
 */

import type { z } from 'zod';
import type {
  MemoryEntry,
  MemoryArtifact,
  MemoryArtifactType,
  MemoryLink,
  MemoryType,
  AttributionType,
  Context,
  AgentProfile,
  Goal,
  GoalStatus,
  GoverningItem,
  GoverningKind,
  GoverningSuggestion,
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
  outranks?: boolean;
  parentId?: string | null;
}

/**
 * Mutable fields on an existing goal — the goal *lifecycle* surface (#14): a goal
 * is the fast-changing sub-priority layer, so its status/weight/title/order can
 * move. Completing a goal (`status: 'COMPLETED'`) drops it from the ACTIVE set
 * `listGoals` feeds the intention lens, so the *same memory pile re-ranks* under
 * the surviving goals (#4/#13) — the lens shifts beneath a core that doesn't.
 *
 * Governing memory is changed by the person (through the host), never by the
 * mind on its own: these setters are the person's direct edits. `parentId`
 * (goal reparenting) is omitted: it's structural, not lifecycle.
 */
export interface GoalPatch {
  status?: GoalStatus;
  weight?: number;
  title?: string;
  description?: string | null;
  order?: number | null;
  outranks?: boolean;
}

/** A governing item as supplied on create (inline with a context/profile, or on its own). */
export interface GoverningItemInput {
  text: string;
  /** 0–1 within its kind; default 0.5. */
  priority?: number;
  /** Default false. */
  outranks?: boolean;
  order?: number | null;
}

/** Shorthand on create: a plain string is an item at default priority that doesn't outrank. */
export type GoverningItemSeed = string | GoverningItemInput;

/** Normalise a seed to a full input (used by stores). */
export function governingInput(seed: GoverningItemSeed): GoverningItemInput {
  return typeof seed === 'string' ? { text: seed } : seed;
}

/**
 * Create one governing item. It is stored with its owner: `value` / `watchWord`
 * on the context, `directive` on the context's agent profile (which must exist).
 */
export interface NewGoverningItem extends GoverningItemInput {
  contextId: string;
  kind: GoverningKind;
}

/** Mutable fields on a governing item (its kind and owner never change). */
export interface GoverningItemPatch {
  text?: string;
  priority?: number;
  outranks?: boolean;
  order?: number | null;
}

/** A suggestion as created (by the mind, via the host). */
export interface NewGoverningSuggestion {
  contextId: string;
  kind: GoverningSuggestion['kind'];
  text: string;
  priority?: number;
  rationale?: string | null;
}

/** Mutable fields on a context — the person's direct edits. */
export interface ContextPatch {
  name?: string;
  seedIntent?: string | null;
  whyItMatters?: string | null;
  description?: string | null;
  direction?: string | null;
  summary?: string | null;
  themes?: string[];
  constraints?: string[];
  assumptions?: string[];
}

/** Mutable fields on an agent profile. */
export interface AgentProfilePatch {
  name?: string | null;
  description?: string | null;
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
  values?: GoverningItemSeed[];
  watchWords?: GoverningItemSeed[];
  parentId?: string | null;
  /**
   * Mark this as the root context. The store keeps at most one per scope and
   * rejects a second.
   */
  isRoot?: boolean;
}

/** Fields supplied when creating a new agent profile. */
export interface NewAgentProfile {
  name?: string | null;
  homeContextId?: string | null;
  description?: string | null;
  directives?: GoverningItemSeed[];
}

/**
 * Fields supplied when linking one memory entry to another. `type` is the
 * host's own edge vocabulary (e.g. "related", "follows", "contradicts") — the
 * library attaches no meaning to it.
 */
export interface NewMemoryLink {
  fromId: string;
  toId: string;
  type: string;
  /** Edge strength, default 1. */
  weight?: number;
  /** Who made the link: the person (`USER_EXPLICIT`, default) or the mind (`AGENT_INFERRED`). */
  attributionType?: AttributionType;
  rationale?: string | null;
}

/** Which links to list for an entry. */
export interface MemoryLinkFilters {
  entryId: string;
  /** `from` = links leaving the entry, `to` = links arriving at it, `both` (default). */
  direction?: 'from' | 'to' | 'both';
  /** Only links of this type. Omit for all types. */
  type?: string;
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
   * The most-recently-created `SUMMARY` artifact in a context, or null (v0.2
   * carryover). This is the "where we left off" thread: a session-end SUMMARY is
   * loaded FIRST at the next wake, by rule — not via semantic recall. Ordering is
   * by creation time (newest wins).
   */
  getLatestSummary(contextId: string): Promise<MemoryArtifact | null>;

  /**
   * Directly set an artifact's `consolidationScore` (clamped to [0,1]) — the
   * standing signal. This is the manual override behind the library's
   * promote/demote; the schema's living loop otherwise accrues consolidation
   * through use (`activateArtifacts`). Returns the updated artifact, or null if
   * it does not exist. (A later activation may recompute this from
   * activationCount; refined promote/decay policy is v0.3.)
   */
  setArtifactConsolidation(id: string, consolidationScore: number): Promise<MemoryArtifact | null>;

  /**
   * The "promoted" artifacts in a context — the packet's promoted slice. Derived
   * beliefs whose `consolidationScore >= minConsolidation` (i.e. settled enough
   * to ride the standing state), ordered by consolidation desc, capped at
   * `limit`. `SUMMARY` artifacts are excluded — those play the carryover role.
   */
  listPromotedArtifacts(contextId: string, minConsolidation: number, limit?: number): Promise<MemoryArtifact[]>;

  /**
   * Create a derived artifact (Bucket C). Persists the pre-computed embedding,
   * records provenance (sourceEntryIds -> ArtifactSourceLink), and writes the
   * critic's goal links (dropping any goalId not in this context).
   */
  createArtifact(input: NewArtifact): Promise<MemoryArtifact>;

  /**
   * Tier-aware clear (v0.2 item D) — HARD-FORGET a context's episodic + derived
   * memory while the standing self survives. Deletes:
   *   - ALL `MemoryEntry` rows in the context (the episodic tier), and
   *   - all `MemoryArtifact` rows EXCEPT `type === 'SUMMARY'` (the derived tier;
   *     promoted beliefs included — promotion is standing, not immunity).
   * KEEPS, by tier:
   *   - governing memory — `Context` / `AgentProfile` / `Goal` (constitutive), and
   *   - the carryover `SUMMARY`(s) — the "where we left off" thread (same
   *     SUMMARY-exclusion rule as `listPromotedArtifacts`).
   * So a `wake()` after a clear RECONSTRUCTS the standing state (identity +
   * carryover) from what survived, with no engine running — continuity lives in
   * the DATA, not a live loop.
   *
   * This is a genuine memory operation (hard delete), deliberately NOT the
   * app-layer soft-delete / `archivedAt` retention concern the cognitive layer
   * excludes by design (see docs/HowDoesCognitiveLayerWork.md). Returns the count
   * of rows removed per tier.
   */
  clearContextMemory(contextId: string): Promise<{ entries: number; artifacts: number }>;

  // --- The living loop (activation feedback) ---
  // Implementations MUST apply the shared rule in lib/comind/activation.ts so
  // recall behaves consistently across backends. Returns the number of rows hit.

  /** Reinforce recalled memory entries that were used this turn. */
  activateEntries(ids: string[]): Promise<number>;
  /** Reinforce recalled artifacts that were used this turn (same rule as entries). */
  activateArtifacts(ids: string[]): Promise<number>;

  // --- Links between memory entries (the associative graph) ---
  /**
   * Create a typed edge between two entries. Creating the same (from, to, type)
   * edge twice returns the existing link rather than duplicating it.
   */
  createLink(input: NewMemoryLink): Promise<MemoryLink>;
  /** Links touching an entry, newest first. */
  listLinks(filters: MemoryLinkFilters): Promise<MemoryLink[]>;

  // --- Context, goals & agent profile (so the library is self-contained) ---
  createContext(input: NewContext): Promise<Context>;
  getContext(id: string): Promise<Context | null>;
  updateContext(id: string, patch: ContextPatch): Promise<Context>;
  /** The context marked `isRoot` for this store's scope. Null if none. */
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
  updateAgentProfile(id: string, patch: AgentProfilePatch): Promise<AgentProfile>;

  // --- Governing items (values, directives, watch words) ---
  createGoverningItem(input: NewGoverningItem): Promise<GoverningItem>;
  updateGoverningItem(id: string, patch: GoverningItemPatch): Promise<GoverningItem>;
  deleteGoverningItem(id: string): Promise<void>;

  // --- Suggestions: governing changes the mind proposes, awaiting the person's OK ---
  createSuggestion(input: NewGoverningSuggestion): Promise<GoverningSuggestion>;
  getSuggestion(id: string): Promise<GoverningSuggestion | null>;
  /** A context's suggestions, oldest first; only `status` ones when given. */
  listSuggestions(contextId: string, status?: GoverningSuggestion['status']): Promise<GoverningSuggestion[]>;
  setSuggestionStatus(id: string, status: GoverningSuggestion['status']): Promise<GoverningSuggestion>;
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
// LLMProvider — the language model, called one named job at a time.
// ---------------------------------------------------------------------------

/**
 * Which job the library is doing when it calls the model. Every call carries
 * one, so a host can route jobs to different models (a strong model for
 * replies, a cheaper one for background extraction) and record which job made
 * which call. The library never picks a model itself.
 *
 * - `reply`      — the guide answering the person (streamed).
 * - `extraction` — distilling durable meaning (decisions, insights, tasks…) from
 *                  an exchange, after the reply.
 * - `summary`    — writing the mind's own understanding of a context.
 * - `drafting`   — proposing governing memory (goals, values, watch words) from
 *                  what the person said.
 *
 * Reserved for jobs the library will add: `coherence`, `loop-closing`. A host may
 * route its OWN jobs through the same provider under its own names.
 */
export type LibraryJob = 'reply' | 'extraction' | 'summary' | 'drafting' | 'coherence' | 'loop-closing';
export type LLMJob = LibraryJob | (string & {});

/** One message in a conversation. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * The model behind the mind. CoMind owns the prompts and output schemas; the
 * provider owns the model choice (and may choose per `job`), so swapping models
 * never touches the cognitive layer.
 */
export interface LLMProvider {
  /** Fill a CoMind-owned schema from a prompt. */
  generateStructured<T>(params: {
    job: LLMJob;
    prompt: string;
    schema: z.ZodType<T>;
    temperature?: number;
  }): Promise<T>;

  /** Stream a free-text reply, chunk by chunk, for a conversation. */
  streamText(params: {
    job: LLMJob;
    system: string;
    messages: ChatMessage[];
    temperature?: number;
  }): AsyncIterable<string>;
}
