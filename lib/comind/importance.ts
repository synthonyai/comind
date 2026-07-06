// lib/comind/importance.ts
//
// Capture-time importance seeding (v0.2 item E) — the SEMANTIC upgrade.
//
// v0.1 stored every raw memory at a flat `importanceScore` (0.5): a cold-start
// where nothing is more significant than anything else until the living loop
// (accessScore/consolidation) slowly differentiates it through use. This seeds
// the *intrinsic significance* at the moment of capture, blended from what the
// schema already carries — most importantly a MEANING-based goal-alignment
// (embedding cosine between the new memory and the context's active goals /
// seed-intent), NOT the lexical `content.includes` keyword overlap the read-time
// intention lens still uses (that lexical→semantic reranker rebuild is v0.3).
//
// Design (PRD_v0.2 decisions #4/#5): alignment is computed ON THE FLY at capture
// and NOT stored — no `GoalEntryLink`, no migration. It only *seeds* the standing
// `importanceScore` field; "currently relevant" stays the read-time rerank and
// "generally useful" stays the operational-signal family. Range stays [0,1].
//
// This is orchestration, not store: the store never embeds and never knows about
// goals. The caller (createComind.storeMemory) gathers + embeds the alignment
// targets through the injected providers and passes the resulting seed down.

import type { EmbeddingProvider, MemoryStore } from '@/lib/comind/providers';
import type { AttributionType } from '@/lib/comind/types';

/**
 * The capture-time importance blend. All tunable — these are first-guess weights,
 * to be revised as recall-quality data accumulates (same posture as
 * `intentions.ts` WEIGHTS). The maximum reachable score is exactly 1.0
 * (FLOOR + GOAL_ALIGN + max attribution + CONFIDENCE·1), so a perfectly aligned,
 * user-stated, fully-confident memory saturates and an off-topic inferred one
 * sits near the floor — a real spread instead of a flat 0.5.
 */
export const IMPORTANCE = {
  /** Everything gets at least this much intrinsic significance. */
  FLOOR: 0.2,
  /** How much semantic goal-alignment (0..1) contributes. The item-E signal. */
  GOAL_ALIGN_WEIGHT: 0.5,
  /** How much the memory's own confidence contributes. */
  CONFIDENCE_WEIGHT: 0.2,
  /**
   * Intrinsic-provenance bump: something the user stated explicitly is inherently
   * weightier at capture than something the agent merely inferred.
   */
  ATTRIBUTION_BUMP: {
    USER_EXPLICIT: 0.1,
    SYSTEM_IMPORT: 0.05,
    AGENT_INFERRED: 0,
  } as Record<AttributionType, number>,
  /** seedIntent is treated as a top-priority alignment target (weight 1.0). */
  SEED_INTENT_WEIGHT: 1.0,
} as const;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Cosine similarity mapped to [0,1]: a negative cosine (unrelated / opposed)
 * reads as zero alignment, not negative importance. Returns 0 when either vector
 * is missing, mismatched, or degenerate (can't rank → no alignment contribution).
 */
export function alignmentSimilarity(a: number[] | null, b: number[] | null): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return Math.max(0, dot / denom);
}

/** A weighted alignment target — an active goal or the context's seed-intent. */
export interface AlignmentTarget {
  embedding: number[] | null;
  /** Priority of this target (goal.weight, or 1.0 for seed-intent). */
  weight: number;
}

/**
 * The pure blend: given the new entry's embedding and the (already-embedded)
 * alignment targets, return the seeded `importanceScore`. Alignment is the
 * best-matching target's cosine scaled by that target's priority (a memory is as
 * important as the most important thing it advances), so one strongly-relevant
 * high-weight goal is enough to mark a memory significant.
 */
export function seedImportanceScore(params: {
  entryEmbedding: number[] | null;
  targets: AlignmentTarget[];
  attributionType?: AttributionType;
  confidence?: number;
}): number {
  const { entryEmbedding, targets, attributionType, confidence } = params;

  let goalAlignment = 0;
  for (const t of targets) {
    goalAlignment = Math.max(goalAlignment, alignmentSimilarity(entryEmbedding, t.embedding) * t.weight);
  }

  const attributionBump = attributionType ? (IMPORTANCE.ATTRIBUTION_BUMP[attributionType] ?? 0) : 0;
  const confidenceTerm = (confidence ?? 0.5) * IMPORTANCE.CONFIDENCE_WEIGHT;

  return clamp01(
    IMPORTANCE.FLOOR +
      goalAlignment * IMPORTANCE.GOAL_ALIGN_WEIGHT +
      attributionBump +
      confidenceTerm
  );
}

/**
 * Orchestration helper: gather the context's active goals + seed-intent, embed
 * them ON THE FLY through the injected embedder, and return the seeded
 * importance for a freshly-captured entry. Not stored anywhere — the embeddings
 * are transient, used only to compute the seed. (A v0.3 optimization could cache
 * goal embeddings; capture volume is low enough that on-the-fly is fine for now.)
 *
 * Falls back to the neutral 0.5 when there is nothing to align against (no goals,
 * no seed-intent) or the entry was never embedded — i.e. it never seeds *below*
 * the v0.1 baseline for a genuine cold start; it only lifts memories that
 * actually advance the standing intent.
 */
export async function seedCaptureImportance(params: {
  contextId: string;
  entryEmbedding: number[] | null;
  attributionType?: AttributionType;
  confidence?: number;
  deps: { store: MemoryStore; embeddings: EmbeddingProvider };
}): Promise<number> {
  const { contextId, entryEmbedding, attributionType, confidence, deps } = params;
  const { store, embeddings } = deps;

  if (!entryEmbedding) return 0.5;

  const [context, goals] = await Promise.all([
    store.getContext(contextId),
    store.listGoals({ contextId, status: 'ACTIVE' }),
  ]);

  const targetSpecs: { text: string; weight: number }[] = [];
  if (context?.seedIntent) targetSpecs.push({ text: context.seedIntent, weight: IMPORTANCE.SEED_INTENT_WEIGHT });
  for (const g of goals) targetSpecs.push({ text: g.title, weight: g.weight ?? 0.5 });

  if (targetSpecs.length === 0) return 0.5;

  const embedded = await Promise.all(targetSpecs.map((s) => embeddings.embed(s.text)));
  const targets: AlignmentTarget[] = targetSpecs.map((s, i) => ({ embedding: embedded[i], weight: s.weight }));

  return seedImportanceScore({ entryEmbedding, targets, attributionType, confidence });
}
