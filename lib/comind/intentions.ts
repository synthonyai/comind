// lib/comind/intentions.ts
import type { EmbeddingProvider, MemoryStore } from "@/lib/comind/providers";
import { loadAncestorIds } from "@/lib/comind/continuity";

type IntentionMatcher = (text: string) => number;

/**
 * Phase 5 injection seam. The recall path embeds the query with an injected
 * EmbeddingProvider and searches an injected MemoryStore. When omitted, the
 * batteries-included default adapters are used (keeps the app + oracle working).
 */
export interface RecallDeps {
  embeddings?: EmbeddingProvider;
  store?: MemoryStore;
  /** How governing items weigh against each other in recall (defaults below). */
  intention?: IntentionSettings;
}

/**
 * The order BETWEEN kinds of governing memory. Each number is the recall weight
 * of an item of that kind at MEDIUM priority (0.5); an item's own priority (0–1)
 * scales it from 0× to 2× (goals use their `weight` as priority — standing and
 * completable alike, and a goal's signs count at its weight). `seedIntent` is a
 * context's single intent line and has no priority.
 */
export interface KindWeights {
  seedIntent: number;
  goal: number;
  directive: number;
  watchWord: number;
}

/** Defaults: goals lead; directives and watch words follow. */
export const DEFAULT_KIND_WEIGHTS: KindWeights = {
  seedIntent: 1.5,
  goal: 0.75,   // a goal at weight 1 → 1.5
  directive: 0.9,
  watchWord: 0.6,
};

/** Default multiplier for governing memory inherited from ancestor contexts. */
export const DEFAULT_INHERITED_WEIGHT = 1.25;

export interface IntentionSettings {
  /** Override the order between kinds (any subset). */
  kindWeights?: Partial<KindWeights>;
  /**
   * Multiplier for goals and watch words INHERITED from the contexts between
   * the root and this one (its ancestors) — default 1.25, so a parent's items
   * weigh a little more than the context's own at the same priority. 1 = same
   * weight. Outranking items are unaffected (they sit in their own band, above
   * everything). Directives don't flow down: they belong to their own agent.
   */
  inheritedWeight?: number;
  /**
   * Minimum cosine similarity to the query for a memory to be recalled at all.
   * Overrides the embedding provider's `relevanceFloor`; 0 turns the cutoff off.
   * Goals only reorder memories that pass it — they can't pull in
   * one that isn't about the message.
   */
  relevanceFloor?: number;
}

/** Resolved weights, including the band outranking items sit in (above every other item). */
interface ResolvedWeights extends KindWeights {
  inheritedWeight: number;
  outranksBase: number;
}

function resolveWeights(settings?: IntentionSettings): ResolvedWeights {
  const k = { ...DEFAULT_KIND_WEIGHTS, ...settings?.kindWeights };
  const inheritedWeight = Math.max(0, settings?.inheritedWeight ?? DEFAULT_INHERITED_WEIGHT);
  // The strongest any non-outranking item can be (a top-priority item of the
  // heaviest kind — inherited ones boosted — or a seed intent); outranking
  // items start just above it.
  const top = Math.max(
    k.seedIntent,
    2 * k.directive,
    2 * Math.max(k.goal, k.watchWord) * Math.max(1, inheritedWeight),
  );
  return { ...k, inheritedWeight, outranksBase: top + 0.25 };
}

/** Weight of one governing item: its kind's weight scaled by priority, or the outranking band. */
function itemWeight(w: ResolvedWeights, kind: keyof KindWeights, priority: number, outranks: boolean, layer: Layer = 'own'): number {
  const p = Math.min(1, Math.max(0, priority));
  if (outranks) return w.outranksBase + 0.5 * p;
  return w[kind] * 2 * p * (layer === 'inherited' ? w.inheritedWeight : 1);
}

/** Where governing memory comes from, relative to the context recall runs for. */
type Layer = 'root' | 'inherited' | 'own';

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
  // Present only when recall is asked to explain itself.
  matched?: MatchedTerm[];
  sameContext?: boolean;
  explanation?: RecallExplanation;
}

// ---------------------------------------------------------------------------
// Explainable recall — WHY a memory came up (opt-in, additive). The ranking is
// identical with or without it; explaining only keeps what the rerank computed.
// ---------------------------------------------------------------------------

/** Where an intention term came from: which governing item, in which context. */
export interface IntentionSource {
  /** `sign` = one of a goal's signs (`itemId` is the goal). */
  kind: 'seedIntent' | 'goal' | 'sign' | 'directive' | 'watchWord';
  /** The governing item's text (goal title, sign, directive, …). */
  text: string;
  /** The goal's / governing item's id (absent for a seed intent). */
  itemId?: string;
  contextId: string;
  /** True when it came from the root context (applies everywhere). */
  root: boolean;
  /** True when it came from an ancestor context (between the root and this one). */
  inherited: boolean;
  /** True when the item outranks (sits above every non-outranking item). */
  outranks: boolean;
}

/** One intention term found in a memory, and the governing item behind it. */
export interface MatchedTerm {
  term: string;
  weight: number;
  in: 'content' | 'tags';
  source: IntentionSource;
}

/** One of the six rerank signals: its raw value, its weight, and what it added. */
export interface RecallSignal {
  value: number;
  weight: number;
  contribution: number;
}

export interface RecallExplanation {
  /** The combined rerank score (sum of the signal contributions). */
  score: number;
  signals: {
    similarity: RecallSignal;
    intention: RecallSignal;
    importance: RecallSignal;
    decayedAccess: RecallSignal;
    creationRecency: RecallSignal;
    consolidation: RecallSignal;
  };
  /** Intention terms found in the memory — what goals/signs/intent boosted it. */
  matched: MatchedTerm[];
  /** Whether the memory belongs to the context recall ran for (it gets a boost). */
  sameContext: boolean;
  /** Artifacts only: source entries this artifact replaced in the results (prefer-artifact dedup). */
  replacedEntryIds: string[];
}

// Common words that say nothing about what a goal or value is about. Without
// this, "Get one or two other people testing it" matched any memory containing
// "other" or "people". English only for now (the matcher itself is lexical —
// matching goals by meaning is a later upgrade).
const STOPWORDS = new Set(`
about above after again against also among because been before being below between both
could does doing done down during each either even ever every from further have having here
into itself just keep like make made many more most much must need never only other others
over really same should since some still such than that their theirs them then there these
they thing things this those through under until upon very want well were what when where
which while will with within without would your yours yourself
`.split(/\s+/).filter(Boolean));

function tokenizeTerms(phrase: string): string[] {
  return phrase
    .toLowerCase()
    .split(/[^\p{L}\p{N}'-]+/u)
    .map(word => word.trim())
    .filter(word => word.length > 3 && !STOPWORDS.has(word));
}

/** The intention lens: term -> weight, plus which governing item each term came from. */
interface IntentionDict {
  weights: Map<string, number>;
  sources: Map<string, IntentionSource>;
}

function applyTerms(
  dict: IntentionDict,
  phrases: string[],
  weight: number,
  source: Omit<IntentionSource, 'text'>
) {
  for (const phrase of phrases) {
    for (const keyword of tokenizeTerms(phrase)) {
      const current = dict.weights.get(keyword) ?? 0;
      // A term keeps its strongest weight; its source is the item that gave it.
      if (!dict.sources.has(keyword) || weight > current) {
        dict.sources.set(keyword, { ...source, text: phrase });
      }
      dict.weights.set(keyword, Math.max(current, weight));
    }
  }
}

async function loadContextSignals(
  store: MemoryStore,
  contextId: string,
  dict: IntentionDict,
  layer: Layer,
  w: ResolvedWeights
) {
  const [agent, context, goals] = await Promise.all([
    // An agent's directives are about that agent: they don't flow down.
    layer === 'inherited' ? null : store.getAgentProfileForContext(contextId),
    store.getContext(contextId),
    store.listGoals({ contextId, status: 'ACTIVE' }),
  ]);
  const at = { contextId, root: layer === 'root', inherited: layer === 'inherited' };

  // Seed intent — the context's guiding intent line (no priority of its own).
  if (context?.seedIntent) {
    applyTerms(dict, [context.seedIntent], w.seedIntent, { kind: 'seedIntent', ...at, outranks: false });
  }

  // Goals — priority is the goal's weight. Its signs (concrete, observable)
  // count at the same weight: they're how an abstract goal shows up in text.
  for (const goal of goals) {
    const outranks = goal.outranks ?? false;
    const weight = itemWeight(w, 'goal', goal.weight ?? 0.5, outranks, layer);
    applyTerms(dict, [goal.title], weight, { kind: 'goal', itemId: goal.id, ...at, outranks });
    const signs = [...(goal.signs?.positive ?? []), ...(goal.signs?.negative ?? [])];
    applyTerms(dict, signs, weight, { kind: 'sign', itemId: goal.id, ...at, outranks });
  }

  // Watch words (the context's) and directives (the agent's).
  const items = [...(context?.watchWords ?? []), ...(agent?.directives ?? [])];
  for (const item of items) {
    applyTerms(dict, [item.text], itemWeight(w, item.kind, item.priority, item.outranks, layer),
      { kind: item.kind, itemId: item.id, ...at, outranks: item.outranks });
  }
}

async function loadIntentionDict(
  contextId: string,
  store: MemoryStore,
  settings?: IntentionSettings
): Promise<IntentionDict> {
  const dict: IntentionDict = { weights: new Map(), sources: new Map() };
  const w = resolveWeights(settings);
  const rootContextId = await store.getRootContextId();

  // Layers, broadest first: the root (applies everywhere), then the ancestors
  // between it and this context (their governing memory flows down), then the
  // context's own.
  if (rootContextId) {
    await loadContextSignals(store, rootContextId, dict, 'root', w);
  }
  if (contextId !== rootContextId) {
    for (const ancestorId of await loadAncestorIds(store, contextId)) {
      await loadContextSignals(store, ancestorId, dict, 'inherited', w);
    }
    await loadContextSignals(store, contextId, dict, 'own', w);
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
  store?: MemoryStore,
  settings?: IntentionSettings
): Promise<IntentionMatcher> {
  const dict = (await loadIntentionDict(contextId, await resolveStore(userId, store), settings)).weights;

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
  store?: MemoryStore,
  settings?: IntentionSettings
): Promise<(candidate: MemoryCandidate) => number> {
  const { normalizationFactor = 3.0, tagBoost = 0.2, contextBoost = 0.1 } = options;
  const dict = (await loadIntentionDict(contextId, await resolveStore(userId, store), settings)).weights;

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

/** Which intention terms a memory contains (content and tags), with their sources. */
function matchTerms(dict: IntentionDict, candidate: MemoryCandidate): MatchedTerm[] {
  const content = candidate.content.toLowerCase();
  const tags = (candidate.tags ?? []).join(' ').toLowerCase();
  const matched: MatchedTerm[] = [];
  for (const [term, weight] of dict.weights.entries()) {
    if (!term) continue;
    const source = dict.sources.get(term)!;
    if (content.includes(term)) matched.push({ term, weight, in: 'content', source });
    if (tags && tags.includes(term)) matched.push({ term, weight, in: 'tags', source });
  }
  return matched.sort((a, b) => b.weight - a.weight);
}

export async function annotateWithIntention(
  userId: string,
  contextId: string,
  candidates: MemoryCandidate[],
  useEnhanced: boolean = false,
  store?: MemoryStore,
  explain: boolean = false,
  settings?: IntentionSettings
): Promise<MemoryCandidateWithIntention[]> {
  // Resolve once so both branches (and the dict load) share one store instance.
  const resolved = await resolveStore(userId, store);
  if (useEnhanced) {
    const matcher = await buildEnhancedIntentionMatcher(userId, contextId, {}, resolved, settings);
    if (!explain) {
      return candidates.map(candidate => ({ ...candidate, intention: matcher(candidate) }));
    }
    const dict = await loadIntentionDict(contextId, resolved, settings);
    return candidates.map(candidate => ({
      ...candidate,
      intention: matcher(candidate),
      matched: matchTerms(dict, candidate),
      sameContext: candidate.contextId === contextId,
    }));
  } else {
    const matcher = await buildIntentionMatcher(userId, contextId, 3.0, resolved, settings);
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
    /** Attach a per-signal `explanation` to each result (ranking unchanged). */
    explain?: boolean;
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
    explain = false,
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

    if (!explain) return { ...candidate, combinedScore };

    const signal = (value: number, weight: number): RecallSignal => ({ value, weight, contribution: value * weight });
    const explanation: RecallExplanation = {
      score: combinedScore,
      signals: {
        similarity: signal(similarity, similarityWeight),
        intention: signal(intention, intentionWeight),
        importance: signal(importance, importanceWeight),
        decayedAccess: signal(decayedAccess, accessWeight),
        creationRecency: signal(creationRecency, creationRecencyWeight),
        consolidation: signal(consolidation, consolidationWeight),
      },
      matched: candidate.matched ?? [],
      sameContext: candidate.sameContext ?? false,
      replacedEntryIds: [],
    };
    return { ...candidate, combinedScore, explanation };
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

  // Relevance floor: a memory must be about the message before anything else
  // counts. Goals/values, recency and importance only REORDER what passes —
  // they can't pull in a memory that isn't about what was said. The number is
  // model-specific (the embedding provider declares it); an app can override.
  const floor = deps?.intention?.relevanceFloor ?? embeddings.relevanceFloor ?? 0;
  const relevant = [...entryCandidates, ...artifactCandidates].filter(
    (c) => floor <= 0 || (c.dist !== undefined && 1 - c.dist >= floor)
  );

  const explain = rerankOptions?.explain ?? false;
  const candidatesWithIntention = await annotateWithIntention(
    userId,
    contextId,
    relevant,
    true,
    store,
    explain,
    deps?.intention
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

  if (explain) {
    const survivingEntryIds = new Set(reranked.filter((c) => c.kind !== 'artifact').map((c) => c.id));
    for (const c of rerankedResults) {
      if (c.kind === 'artifact' && c.explanation) {
        c.explanation.replacedEntryIds = (c.sourceEntryIds ?? []).filter((id) => survivingEntryIds.has(id));
      }
    }
  }

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