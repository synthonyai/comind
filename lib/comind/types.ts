/**
 * CoMind core types — the cognitive layer's own view of its domain.
 *
 * These are plain TypeScript interfaces that CoMind OWNS. They are deliberately
 * free of `@prisma/client`: the Prisma schema is one *mapping* of these types
 * (handled inside the store adapter), not their source of truth. A consumer
 * embedding CoMind should be able to depend on these without pulling in Prisma,
 * Next.js, or any database.
 *
 * Phase 1 of V01_IMPLEMENTATION_PLAN.md — additive. Nothing references these yet;
 * later phases switch the library and store over to them.
 *
 * Design notes:
 * - Enums are CoMind-owned string unions (same values as the schema enums).
 * - `embedding` is dimension-agnostic here (`number[] | null`), not `vector(1024)`.
 *   The fixed dimension lives in the default store, guarded at construction.
 * - App-only fields (mood, chatHistory, viewCount, chatInteractions, soft-delete /
 *   archive, UI styling) are intentionally absent — they are the app's concern.
 * - `userId` is intentionally absent from MemoryEntry: user/owner scoping is the
 *   app's multi-tenant concept (out of scope for v0.1) and is handled by the store
 *   adapter, not the cognitive layer.
 * - The full cognitive model is expressed here even where not yet wired: the
 *   weighting signals, the associative graph (MemoryLink) and derivation/provenance
 *   (ArtifactSourceLink) are the three v0.1 cognitive targets (see docs/PRD.md).
 */

// ---------------------------------------------------------------------------
// Enums (CoMind-owned string unions — no @prisma/client)
// ---------------------------------------------------------------------------

export type MemoryType = 'NOTE' | 'CHAT_SESSION' | 'UPLOAD';

export type MemoryArtifactType =
  | 'DECISION'
  | 'INSIGHT'
  | 'FACT'
  | 'TASK'
  | 'QUESTION'
  | 'CONSTRAINT'
  | 'SUMMARY';

export type AttributionType = 'USER_EXPLICIT' | 'AGENT_INFERRED' | 'SYSTEM_IMPORT';

export type GoalStatus = 'ACTIVE' | 'COMPLETED' | 'PAUSED' | 'ARCHIVED';

// ---------------------------------------------------------------------------
// MemoryEntry — the raw memory unit
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  id: string;
  contextId: string;

  type: MemoryType;
  subtype?: string | null;

  title?: string | null;
  content: string;
  tags: string[];

  /** When the memory is considered to have happened. */
  timestamp: Date;
  /** When the memory was ingested into CoMind. */
  capturedAt: Date;

  /** Semantic vector. Dimension-agnostic at the type level; null until embedded. */
  embedding: number[] | null;

  // --- Weighting / operational signals (cognitive target #1) ---
  importanceScore: number;
  accessScore: number;
  consolidationScore: number;
  activationCount: number;
  lastActivatedAt?: Date | null;
  confidence: number;

  // --- Provenance (cognitive target #3) ---
  attributionType: AttributionType;
  /** If this entry was derived from another entry, its id. */
  derivedFromId?: string | null;

  // --- Source / ingestion provenance (optional; multi-source ingestion) ---
  sourceType?: string | null;
  sourceId?: string | null;
  sourceUri?: string | null;
}

// ---------------------------------------------------------------------------
// MemoryArtifact — derived meaning produced by the memory critic
// ---------------------------------------------------------------------------

export interface MemoryArtifact {
  id: string;
  contextId: string;

  type: MemoryArtifactType;

  title?: string | null;
  content: string;
  tags: string[];

  confidence: number;

  /** Semantic vector. Dimension-agnostic; null until embedded. */
  embedding: number[] | null;

  // --- Weighting / operational signals (cognitive target #1) ---
  accessScore: number;
  /**
   * How settled/established this belief is vs. still tentative — the schema's
   * standing signal (indexed for "give me the most consolidated"). v0.2
   * promotion is expressed THROUGH this: a highly-consolidated derived belief is
   * "promoted" and rides the continuity packet. Standing, not kind — a promoted
   * belief stays a MemoryArtifact, never copied into a governing directive.
   */
  consolidationScore: number;
  activationCount: number;
  lastActivatedAt?: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// GoverningItem — one thing the mind steers by (a directive or a watch word)
// ---------------------------------------------------------------------------

/**
 * The kinds of governing item. Each is stored with its owner: `watchWord`
 * describes the work and lives on the `Context`; `directive` describes how the
 * agent behaves and lives on the `AgentProfile`. What the person steers BY —
 * things to achieve and standing commitments alike — are goals (see `Goal`,
 * `standing`), which share `priority` (as `weight`) and `outranks`.
 */
export type GoverningKind = 'directive' | 'watchWord';

export interface GoverningItem {
  id: string;
  kind: GoverningKind;
  text: string;
  /**
   * Importance WITHIN its kind, 0–1 (default 0.5). The order BETWEEN kinds is a
   * separate setting (`CreateComindConfig.intention.kindWeights`).
   */
  priority: number;
  /**
   * Comes before every item that doesn't outrank, whatever its kind or context:
   * top weight in recall, and shown to the model as coming first.
   */
  outranks: boolean;
  /** Display order within its kind (host-managed). */
  order?: number | null;
}

/**
 * A change the MIND proposes to governing memory, waiting for the person's OK.
 * Governing memory is the person's: the mind never changes it directly — it
 * suggests, and an approved suggestion is applied with the normal verbs.
 */
export interface GoverningSuggestion {
  id: string;
  contextId: string;
  /** What it would add: a goal, or a governing item of this kind. */
  kind: 'goal' | GoverningKind;
  text: string;
  /** For a goal: ongoing (no finish line) rather than completable. */
  standing?: boolean;
  /** For a goal: ids of goals it would support (see `Goal.supports`). */
  supports?: string[];
  /** Proposed priority (goal weight / item priority), 0–1. */
  priority: number;
  /** Why the mind suggests it (shown to the person). */
  rationale?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Context — a scoped cognitive space
// ---------------------------------------------------------------------------

export interface Context {
  id: string;
  name: string;

  seedIntent?: string | null;
  whyItMatters?: string | null;
  direction?: string | null;
  summary?: string | null;
  description?: string | null;

  themes: string[];
  constraints: string[];
  assumptions: string[];
  /** Words or patterns that should catch attention (e.g. for a coherence check). */
  watchWords: GoverningItem[];

  parentId?: string | null;
  /**
   * The root context: its governing memory applies in every context and comes
   * first. At most one per store scope (explicit, never inferred).
   */
  isRoot: boolean;

  createdAt: Date;
}

// ---------------------------------------------------------------------------
// AgentProfile — how an agent operates inside a context
// ---------------------------------------------------------------------------

export interface AgentProfile {
  id: string;
  name?: string | null;
  homeContextId?: string | null;

  description?: string | null;
  /** How the agent should act — its standing instructions, each with a priority. */
  directives: GoverningItem[];
}

// ---------------------------------------------------------------------------
// Goal — drives intention scoring and weighting (cognitive target #1)
// ---------------------------------------------------------------------------

export interface Goal {
  id: string;
  contextId: string;

  title: string;
  description?: string | null;
  status: GoalStatus;

  /** Priority among this context's goals, 0–1. */
  weight: number;
  order?: number | null;
  /** Comes before everything that doesn't outrank (see `GoverningItem.outranks`). */
  outranks: boolean;
  /**
   * Ongoing, with no finish line — a standing commitment or principle ("eat at
   * regular times") rather than something to complete ("run a 10k"). A standing
   * goal is never COMPLETED (it can be PAUSED or ARCHIVED); the guide must not
   * treat it as stalled or ask whether it is done.
   */
  standing: boolean;
  /**
   * Ids of other goals this one supports — in any context, typically a broader
   * goal in an ancestor or the root context ("lights out by 11" supports
   * "stabilized energy"). Many-to-many; empty when it supports none.
   */
  supports: string[];
  /**
   * Concrete, observable signs of this goal, in the person's words: what it
   * looks like when it's being lived (`positive`) and when it's drifting
   * (`negative`). They make an abstract goal recognisable in what gets written.
   */
  signs: GoalSigns;

  parentId?: string | null;
}

/** See `Goal.signs`. */
export interface GoalSigns {
  positive: string[];
  negative: string[];
}

// ---------------------------------------------------------------------------
// MemoryLink — the associative graph between memory entries (cognitive target #2)
// ---------------------------------------------------------------------------

export interface MemoryLink {
  id: string;

  fromId: string;
  toId: string;

  /** Edge kind, e.g. "related". Free-form for v0.1. */
  type: string;
  weight: number;

  attributionType: AttributionType;
  rationale?: string | null;

  createdAt: Date;
}

// ---------------------------------------------------------------------------
// ArtifactSourceLink — derivation/provenance: which entries an artifact came from
// (cognitive target #3)
// ---------------------------------------------------------------------------

export interface ArtifactSourceLink {
  artifactId: string;
  memoryEntryId: string;

  attributionType: AttributionType;
  rationale?: string | null;

  createdAt: Date;
}
