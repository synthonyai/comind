// lib/comind/contextRecall.ts
//
// Shared recall core (Bucket E / step 1 — consolidate the two assemblers).
// Both context-packet assemblers — `recallForContext` (recall.ts, the app
// inspector) and `getRecallData` (agentRuntime/dataFetcher.ts, the runtime) —
// used to duplicate the same sequence: embed the query, run the 6-signal
// intention rerank, then re-fetch the surviving rows. Bucket C / P2 made
// entries and artifacts compete in ONE rerank (results carry `kind`); this is
// the single place that slices the reranked rows and hydrates each from its own
// table, splitting them back into entries vs. derived artifacts.
import { searchWithIntention } from "@/lib/comind/intentions";
import type { RecallDeps, RecallExplanation } from "@/lib/comind/intentions";
import type { MemoryEntry } from "@/lib/comind/types";

/** A hydrated raw memory entry plus its intention score from the rerank. */
export type RecalledEntry = MemoryEntry & {
  intention: number;
  /** Why it came up — present only when recall was called with `explain: true`. */
  why?: RecallExplanation;
};

/** A hydrated derived artifact plus its intention score from the rerank. */
export interface RecalledArtifact {
  id: string;
  type: string;
  content: string;
  confidence: number;
  createdAt: Date;
  intention: number;
  /** Why it came up — present only when recall was called with `explain: true`. */
  why?: RecallExplanation;
}

/**
 * Run intention-weighted recall and hydrate the surviving rows, split by kind.
 *
 * - `searchLimit` (default 8) — how many candidates each table contributes to
 *   the rerank, before prefer-artifact dedup.
 * - `limit` — final cap on reranked rows to hydrate. Omit to hydrate all
 *   survivors (the runtime path); pass a number to cap (the inspector path).
 * - `explain` — attach `why` (score, the six signals, the governing items that
 *   boosted it). Additive: the ranking is the same either way.
 * - `deps` — injected embedder/store; defaults to the batteries-included
 *   adapters inside `searchWithIntention` when omitted.
 */
export async function recallEntriesAndArtifacts(params: {
  userId: string;
  contextId: string;
  query: string;
  limit?: number;
  searchLimit?: number;
  explain?: boolean;
  deps?: RecallDeps;
}): Promise<{ entries: RecalledEntry[]; artifacts: RecalledArtifact[] }> {
  const { userId, contextId, query, limit, searchLimit = 8, explain = false, deps } = params;

  // Soft-membership recall (v0.2 decision #6): context = foreground, not box. The
  // candidate POOL is cross-context (`contextId: null` — the store returns all
  // contexts), while the intention `contextId` still drives the same-context
  // boost inside `annotateWithIntention`. So own-context memories rank higher but
  // other-context memories still compete at lower weight. (Flat bleed for now;
  // hierarchy-aware bleed via Context.parentId is a v0.3 refinement.)
  const { results } = await searchWithIntention(
    userId,
    contextId,
    query,
    { contextId: null, limit: searchLimit },
    explain ? { explain: true } : undefined,
    deps
  );

  const selected = limit !== undefined ? results.slice(0, limit) : results;

  // Hydrate the reranked survivors through the injected store, so this path works
  // against any MemoryStore. The store is required — the library ships no default.
  const store = deps?.store;
  if (!store) throw new Error('CoMind: recall requires an injected MemoryStore (no default backend).');

  const hydrated = await Promise.all(
    selected.map(async (r) => {
      const intention = (r as { intention?: number }).intention ?? 0;
      const why = explain ? { why: r.explanation } : {};
      if (r.kind === "artifact") {
        const artifact = await store.getArtifact(r.id);
        return artifact
          ? ({
              kind: "artifact" as const,
              row: {
                id: artifact.id,
                type: artifact.type,
                content: artifact.content,
                confidence: artifact.confidence,
                createdAt: artifact.createdAt,
                intention,
                ...why,
              },
            })
          : null;
      }
      const entry = await store.getMemoryEntry(r.id);
      return entry ? ({ kind: "entry" as const, row: { ...entry, intention, ...why } }) : null;
    })
  );

  const entries: RecalledEntry[] = [];
  const artifacts: RecalledArtifact[] = [];
  for (const h of hydrated) {
    if (!h) continue;
    if (h.kind === "artifact") artifacts.push(h.row as RecalledArtifact);
    else entries.push(h.row as RecalledEntry);
  }
  return { entries, artifacts };
}
