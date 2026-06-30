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
  consolidationScore: number;
  activationCount: number;
  lastActivatedAt?: Date | null;

  createdAt: Date;
  updatedAt: Date;
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
  values: string[];

  parentId?: string | null;

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
  directives: string[];
  watchWords: string[];
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

  weight: number;
  order?: number | null;

  parentId?: string | null;
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
