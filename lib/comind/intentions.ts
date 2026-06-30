// lib/comind/intentions.ts
import type { EmbeddingProvider, MemoryStore } from "@/lib/comind/providers";

type IntentionMatcher = (text: string) => number;

/**
 * Phase 5 injection seam. The recall path embeds the query with an injected
 * EmbeddingProvider and searches an injected MemoryStore. When omitted, the
 * batteries-included default adapters are used (keeps the app + oracle working).
 */
export interface RecallDeps {
  embeddings?: EmbeddingProvider;
  store?: MemoryStore;
}

interface MemoryCandidate {
  id: string;
  content: string;
  timestamp: Date;
  dist?: number;
  contextId?: string;
  tags?: string[];
  importanceScore?: number;
  // Operational signals (Bucket B — the living loop)
  accessScore?: number;
  consolidationScore?: number;
  lastActivatedAt?: Date | null;
  // Bucket C / P2 — entries and artifacts ride the same rerank. `kind`
  // discriminates them so the assembler hydrates from the right table;
  // `sourceEntryIds` (artifacts only) drives prefer-artifact dedup.
  kind?: 'entry' | 'artifact';
  sourceEntryIds?: string[];
}

interface MemoryCandidateWithIntention extends MemoryCandidate {
  intention: number;
}

// Weight hierarchy — goals are primary recall drivers, everything else is secondary.
// Tune these values as recall quality data accumulates.
const WEIGHTS = {
  GOAL_BASE: 1.5,   // multiplied by goal.weight (0–1), so range is 0–1.5
  VALUE: 0.7,       // guiding principles — background context, primarily feeds coherence
  DIRECTIVE: 0.9,   // agent directives — behavioral signals
  WATCH_WORD: 0.6,  // quick attention triggers — no longer the primary driver
} as const;

function tokenizeTerms(phrase: string): string[] {
  return phrase
    .toLowerCase()
    .split(/[,\s]+/)
    .map(word => word.trim())
    .filter(word => word.length > 3);
}

function applyTerms(
  dict: Map<string, number>,
  phrases: string[],
  weight: number
) {
  for (const phrase of phrases) {
    for (const keyword of tokenizeTerms(phrase)) {
      dict.set(keyword, Math.max(dict.get(keyword) ?? 0, weight));
    }
  }
}

async function loadContextSignals(
  store: MemoryStore,
  contextId: string,
  dict: Map<string, number>
) {
  const [agent, context, goals] = await Promise.all([
    store.getAgentProfileForContext(contextId),
    store.getContext(contextId),
    store.listGoals({ contextId, status: 'ACTIVE' }),
  ]);

  // Seed intent — north star for the context, weighted same as a high-priority goal
  if (context?.seedIntent) {
    applyTerms(dict, [context.seedIntent], WEIGHTS.GOAL_BASE);
  }

  // Goals — primary signal, scaled by goal.weight
  for (const goal of goals) {
    const goalWeight = WEIGHTS.GOAL_BASE * (goal.weight ?? 0.5);
    applyTerms(dict, [goal.title], goalWeight);
  }

  // Agent directives and watchwords
  if (agent) {
    applyTerms(dict, agent.directives ?? [], WEIGHTS.DIRECTIVE);
    applyTerms(dict, agent.watchWords ?? [], WEIGHTS.WATCH_WORD);
  }

  // Guiding principles
  applyTerms(dict, context?.values ?? [], WEIGHTS.VALUE);
}

async function loadIntentionDict(
  contextId: string,
  store: MemoryStore
): Promise<Map<string, number>> {
  const dict = new Map<string, number>();
  // Root resolved through the store (parentId === null for this scope), so the
  // intention dict no longer depends on Prisma.
  const rootContextId = await store.getRootContextId();

  if (rootContextId) {
    await loadContextSignals(store, rootContextId, dict);
  }

  if (contextId !== rootContextId) {
    await loadContextSignals(store, contextId, dict);
  }

  return dict;
}

/** The injected store is required — there is no built-in backend in the library. */
async function resolveStore(_userId: string, store?: MemoryStore): Promise<MemoryStore> {
  if (!store) throw new Error('CoMind: a MemoryStore must be injected (no default backend).');
  return store;
}

export async function buildIntentionMatcher(
  userId: string,
  contextId: string,
  normalizationFactor: number = 3.0,
  store?: MemoryStore
): Promise<IntentionMatcher> {
  const dict = await loadIntentionDict(contextId, await resolveStore(userId, store));

  return (text: string): number => {
    if (!text) return 0;
    const lc = text.toLowerCase();
    let hitWeight = 0;
    for (const [term, weight] of dict.entries()) {
      if (!term) continue;
      if (lc.includes(term)) hitWeight += weight;
    }
    return Math.min(1, hitWeight / normalizationFactor);
  };
}

export async function buildEnhancedIntentionMatcher(
  userId: string,
  contextId: string,
  options: {
    normalizationFactor?: number;
    tagBoost?: number;
    contextBoost?: number;
  } = {},
  store?: MemoryStore
): Promise<(candidate: MemoryCandidate) => number> {
  const { normalizationFactor = 3.0, tagBoost = 0.2, contextBoost = 0.1 } = options;
  const dict = await loadIntentionDict(contextId, await resolveStore(userId, store));

  return (candidate: MemoryCandidate): number => {
    let totalScore = 0;

    const content = candidate.content.toLowerCase();
    let contentHits = 0;
    for (const [term, weight] of dict.entries()) {
      if (!term) continue;
      if (content.includes(term)) contentHits += weight;
    }
    totalScore += Math.min(1, contentHits / normalizationFactor);

    if (candidate.tags && tagBoost > 0) {
      const tagString = candidate.tags.join(' ').toLowerCase();
      let tagHits = 0;
      for (const [term, weight] of dict.entries()) {
        if (!term) continue;
        if (tagString.includes(term)) tagHits += weight;
      }
      totalScore += Math.min(tagBoost, (tagHits * tagBoost) / normalizationFactor);
    }

    if (candidate.contextId === contextId && contextBoost > 0) {
      totalScore += contextBoost;
    }

    return Math.min(1, totalScore);
  };
}

export async function annotateWithIntention(
  userId: string,
  contextId: string,
  candidates: MemoryCandidate[],
  useEnhanced: boolean = false,
  store?: MemoryStore
): Promise<MemoryCandidateWithIntention[]> {
  // Resolve once so both branches (and the dict load) share one store instance.
  const resolved = await resolveStore(userId, store);
  if (useEnhanced) {
    const matcher = await buildEnhancedIntentionMatcher(userId, contextId, {}, resolved);
    return candidates.map(candidate => ({ ...candidate, intention: matcher(candidate) }));
  } else {
    const matcher = await buildIntentionMatcher(userId, contextId, 3.0, resolved);
    return candidates.map(candidate => ({ ...candidate, intention: matcher(candidate.content) }));
  }
}

// Bucket B — six-signal rerank. Two TIME axes, deliberately split (they answer
// different questions and pair with different durability signals):
//   • creationRecency (from `timestamp`) — freshness/topicality; the BOOTSTRAP
//     that carries a brand-new memory before it's ever been retrieved.
//   • decayedAccess (accessScore × use-recency from `lastActivatedAt`) — the
//     fast/fragile "recently reached" signal; high right after use, fades without.
//   • consolidationScore — the slow/durable floor that keeps a heavily-used but
//     not-recently-used memory reachable (so use-recency decay can't over-punish
//     established memories). This is the fast/fragile vs. slow/durable split.
// Disuse fades LAZILY here (no batch sweep): a memory that isn't recalled is
// never written, so the time since `lastActivatedAt` grows and decayedAccess
// shrinks on its own at read time.
export function rerankWithIntention(
  candidates: MemoryCandidateWithIntention[],
  options: {
    similarityWeight?: number;
    intentionWeight?: number;
    importanceWeight?: number;
    accessWeight?: number;
    creationRecencyWeight?: number;
    consolidationWeight?: number;
    creationRecencyDecayDays?: number;
    useRecencyDecayDays?: number;
  } = {}
): MemoryCandidateWithIntention[] {
  const {
    similarityWeight = 0.30,
    intentionWeight = 0.25,
    importanceWeight = 0.15,
    accessWeight = 0.15,
    creationRecencyWeight = 0.10,
    consolidationWeight = 0.05,
    creationRecencyDecayDays = 30,
    useRecencyDecayDays = 14,
  } = options;

  const now = new Date();
  const dayMs = 1000 * 60 * 60 * 24;

  const scoredCandidates = candidates.map(candidate => {
    const similarity = candidate.dist !== undefined ? Math.max(0, 1 - candidate.dist) : 0;
    const intention = candidate.intention;
    const importance = candidate.importanceScore ?? 0.5;

    // Creation recency — freshness from when the memory was formed.
    const daysSinceCreated = (now.getTime() - candidate.timestamp.getTime()) / dayMs;
    const creationRecency = Math.exp(-daysSinceCreated / creationRecencyDecayDays);

    // Decayed access — reinforcement (accessScore) modulated MULTIPLICATIVELY by
    // use-recency. Never-activated memories have no use-recency yet, so this term
    // is 0 and creationRecency carries them until their first activation.
    const access = candidate.accessScore ?? 0.5;
    const useRecency = candidate.lastActivatedAt
      ? Math.exp(-((now.getTime() - candidate.lastActivatedAt.getTime()) / dayMs) / useRecencyDecayDays)
      : 0;
    const decayedAccess = access * useRecency;

    // Consolidation — slow/durable floor.
    const consolidation = candidate.consolidationScore ?? 0.3;

    const combinedScore =
      (similarity * similarityWeight) +
      (intention * intentionWeight) +
      (importance * importanceWeight) +
      (decayedAccess * accessWeight) +
      (creationRecency * creationRecencyWeight) +
      (consolidation * consolidationWeight);

    return { ...candidate, combinedScore };
  });

  return scoredCandidates
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .map(({ combinedScore, ...candidate }) => candidate);
}

export async function searchWithIntention(
  userId: string,
  contextId: string,
  query: string,
  searchFilters: {
    contextId?: string | null;
    tagsAny?: string[];
    limit?: number;
  } = {},
  rerankOptions?: Parameters<typeof rerankWithIntention>[1],
  deps?: RecallDeps
): Promise<{
  results: MemoryCandidateWithIntention[];
  metadata: {
    totalCandidates: number;
    avgIntentionScore: number;
    topIntentionScore: number;
  };
}> {
  // Phase 5: embedding moved OUT of the store. The orchestration layer embeds the
  // query (injected EmbeddingProvider) and hands a VECTOR to store.searchSimilar;
  // the store never embeds. Both providers are required — the library ships no
  // default backend (the host injects them, e.g. via createComind).
  const embeddings = deps?.embeddings;
  const store = deps?.store;
  if (!embeddings) throw new Error('CoMind: an EmbeddingProvider must be injected (no default backend).');
  if (!store) throw new Error('CoMind: a MemoryStore must be injected (no default backend).');

  const vector = await embeddings.embedQuery(query);
  // Bucket C / P2: entries and artifacts are searched in parallel, then reranked
  // together so derived meaning competes with raw input on the same 6 signals.
  const [hits, artifactHits] = await Promise.all([
    store.searchSimilar({
      vector,
      contextId: searchFilters.contextId,
      tagsAny: searchFilters.tagsAny,
      limit: searchFilters.limit,
    }),
    store.searchSimilarArtifacts({
      vector,
      contextId: searchFilters.contextId,
      tagsAny: searchFilters.tagsAny,
      limit: searchFilters.limit,
    }),
  ]);

  // Bucket A (un-hollow recall): carry the store's rich entries through to the
  // matcher and rerank. tags/contextId enable the enhanced matcher's tag/context
  // boosts; importanceScore makes the rerank's importance signal real instead of a
  // flat 0.5. This is the first INTENDED recall-behavior change — it deliberately
  // moves off the Phase 0 baseline (the oracle re-baselines on the reviewed diff;
  // a red oracle here is success, not regression).
  const entryCandidates: MemoryCandidate[] = hits.map((h) => ({
    id: h.entry.id,
    content: h.entry.content,
    timestamp: h.entry.timestamp,
    dist: h.distance,
    contextId: h.entry.contextId,
    tags: h.entry.tags,
    importanceScore: h.entry.importanceScore,
    // Bucket B (the living loop): carry the operational signals through so the
    // rerank's decayedAccess + consolidation terms are real, not defaults.
    accessScore: h.entry.accessScore,
    consolidationScore: h.entry.consolidationScore,
    lastActivatedAt: h.entry.lastActivatedAt,
    kind: 'entry',
  }));

  // Bucket C / P2: artifact -> candidate. Map confidence into the importance slot
  // (an artifact's confidence is its analogous "how much this matters"), createdAt
  // into the timestamp axis, and carry the same operational signals entries use.
  const artifactCandidates: MemoryCandidate[] = artifactHits.map((h) => ({
    id: h.artifact.id,
    content: h.artifact.content,
    timestamp: h.artifact.createdAt,
    dist: h.distance,
    contextId: h.artifact.contextId,
    tags: h.artifact.tags,
    importanceScore: h.artifact.confidence,
    accessScore: h.artifact.accessScore,
    consolidationScore: h.artifact.consolidationScore,
    lastActivatedAt: h.artifact.lastActivatedAt,
    kind: 'artifact',
    sourceEntryIds: h.sourceEntryIds,
  }));

  const candidatesWithIntention = await annotateWithIntention(
    userId,
    contextId,
    [...entryCandidates, ...artifactCandidates],
    true,
    store
  );

  const reranked = rerankWithIntention(candidatesWithIntention, rerankOptions);

  // Prefer-artifact dedup (decided 2026-06-27): when a distilled artifact and one
  // of its source entries both survive, the artifact takes the slot; the source
  // entry collapses under it (still reachable via provenance). Applied AFTER the
  // rerank so each row is scored on its own merits first.
  const supersededEntryIds = new Set(
    reranked
      .filter((c) => c.kind === 'artifact')
      .flatMap((c) => c.sourceEntryIds ?? [])
  );
  const rerankedResults = reranked.filter(
    (c) => c.kind === 'artifact' || !supersededEntryIds.has(c.id)
  );

  const intentionScores = candidatesWithIntention.map(c => c.intention);
  const avgIntentionScore = intentionScores.length > 0
    ? intentionScores.reduce((sum, score) => sum + score, 0) / intentionScores.length
    : 0;
  const topIntentionScore = Math.max(...intentionScores, 0);

  return {
    results: rerankedResults,
    metadata: { totalCandidates: candidatesWithIntention.length, avgIntentionScore, topIntentionScore }
  };
}

// Note: the Prisma-backed inspector helpers (getIntentionTerms / findRootContextId
// / extractTermsFromContext) were removed in the open-source carve. The standing
// intention lens is loaded Prisma-free through the injected store
// (loadIntentionDict → store.getRootContextId / store.getContext / store.listGoals).