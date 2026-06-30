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
import type { RecallDeps } from "@/lib/comind/intentions";
import type { MemoryEntry } from "@/lib/comind/types";

/** A hydrated raw memory entry plus its intention score from the rerank. */
export type RecalledEntry = MemoryEntry & { intention: number };

/** A hydrated derived artifact plus its intention score from the rerank. */
export interface RecalledArtifact {
  id: string;
  type: string;
  content: string;
  confidence: number;
  createdAt: Date;
  intention: number;
}

/**
 * Run intention-weighted recall and hydrate the surviving rows, split by kind.
 *
 * - `searchLimit` (default 8) — how many candidates each table contributes to
 *   the rerank, before prefer-artifact dedup.
 * - `limit` — final cap on reranked rows to hydrate. Omit to hydrate all
 *   survivors (the runtime path); pass a number to cap (the inspector path).
 * - `deps` — injected embedder/store; defaults to the batteries-included
 *   adapters inside `searchWithIntention` when omitted.
 */
export async function recallEntriesAndArtifacts(params: {
  userId: string;
  contextId: string;
  query: string;
  limit?: number;
  searchLimit?: number;
  deps?: RecallDeps;
}): Promise<{ entries: RecalledEntry[]; artifacts: RecalledArtifact[] }> {
  const { userId, contextId, query, limit, searchLimit = 8, deps } = params;

  const { results } = await searchWithIntention(
    userId,
    contextId,
    query,
    { contextId, limit: searchLimit },
    undefined,
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
              },
            })
          : null;
      }
      const entry = await store.getMemoryEntry(r.id);
      return entry ? ({ kind: "entry" as const, row: { ...entry, intention } }) : null;
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
