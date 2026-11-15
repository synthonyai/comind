/**
 * createComind — the public entry point. Assembles the three injected providers
 * into a single instance exposing the public methods.
 *
 * Prisma-free by construction: this module imports ONLY types (erased at
 * runtime). The runtime is pulled in via dynamic `import()` inside the turn verbs,
 * and every other method calls straight through to the injected providers. There
 * is NO built-in backend — a consumer embeds CoMind by implementing the three
 * provider interfaces (MemoryStore, EmbeddingProvider, LLMProvider) and passing
 * them in, so nothing Prisma/HuggingFace/OpenAI loads unless their own providers
 * pull it in. This is the "no lock-in" guarantee the demo proves (demo:prove).
 *
 * `userId` is a transitional tenant tag threaded into the runtime; non-tenant
 * stores (e.g. the in-memory reference store) ignore it.
 */

import type {
  MemoryStore, EmbeddingProvider, LLMProvider, NewContext, NewGoal, GoalPatch, NewAgentProfile, MemoryEntryFilters,
  NewMemoryLink, MemoryLinkFilters, ContextPatch, AgentProfilePatch, GoverningItemInput, GoverningItemPatch,
} from '@/lib/comind/providers';
import type { IntentionSettings } from '@/lib/comind/intentions';
import type { TurnOptions, GuideInput } from '@/lib/comind/agentRuntime/types';
import type { MemoryType, AttributionType, GoalStatus, GoverningKind, GoverningSuggestion } from '@/lib/comind/types';
import type { DraftSubject } from '@/lib/comind/governance';
import { recallEntriesAndArtifacts } from '@/lib/comind/contextRecall';
import { assembleContinuityState, PROMOTION } from '@/lib/comind/continuity';
import { seedCaptureImportance } from '@/lib/comind/importance';

export interface CreateComindConfig {
  /** Transitional tenant tag threaded into the runtime; non-tenant stores ignore it. */
  userId: string;
  /** Persistence + retrieval. Required — there is no default backend. */
  store: MemoryStore;
  /** Text → vector. Required — there is no default backend. */
  embeddings: EmbeddingProvider;
  /** The language model, called one named job at a time. Required — there is no default backend. */
  llm: LLMProvider;
  /**
   * How governing memory weighs in recall — e.g. the order between kinds
   * (`kindWeights`). Optional; defaults to `DEFAULT_KIND_WEIGHTS`.
   */
  intention?: IntentionSettings;
}

/**
 * The verbs for one kind of governing item. Each item is stored with its owner
 * (watch words on the context, directives on its agent profile).
 * These are the person's direct edits — they apply immediately.
 */
function governingVerbs(store: MemoryStore, kind: GoverningKind) {
  return {
    add: (contextId: string, item: GoverningItemInput) => store.createGoverningItem({ ...item, contextId, kind }),
    update: (id: string, patch: GoverningItemPatch) => store.updateGoverningItem(id, patch),
    remove: (id: string) => store.deleteGoverningItem(id),
  };
}

export function createComind(config: CreateComindConfig) {
  const { userId, store, embeddings, llm, intention } = config;

  return {
    /**
     * Store a raw observation: embed its content with the injected embedder, then
     * persist it through the injected store. The cognitive loop (`runAgent`) does
     * this for the critic's conclusions; this is the host's hook for raw inputs.
     *
     * When the caller doesn't pin an `importanceScore`, it's SEEDED at capture
     * (v0.2 item E) from a semantic goal-alignment blend — cosine between the new
     * memory and the context's active goals / seed-intent, computed on the fly and
     * not stored — killing the flat-0.5 cold-start. A caller-supplied score always
     * wins (explicit intent over the heuristic).
     */
    storeMemory: async (params: {
      contextId: string;
      content: string;
      type?: MemoryType;
      tags?: string[];
      sourceType?: string;
      importanceScore?: number;
      attributionType?: AttributionType;
      confidence?: number;
      /**
       * Link the new entry to existing ones, in the host's own edge vocabulary
       * (e.g. `{ toId, type: 'follows' }`). Created after the entry, from it.
       */
      links?: { toId: string; type: string; weight?: number; rationale?: string }[];
    }) => {
      const embedding = await embeddings.embed(params.content);
      const importanceScore =
        params.importanceScore ??
        (await seedCaptureImportance({
          contextId: params.contextId,
          entryEmbedding: embedding,
          attributionType: params.attributionType,
          confidence: params.confidence,
          deps: { store, embeddings },
        }));
      const entry = await store.createMemoryEntry({
        contextId: params.contextId,
        type: params.type ?? 'NOTE',
        content: params.content,
        tags: params.tags,
        sourceType: params.sourceType,
        attributionType: params.attributionType,
        confidence: params.confidence,
        importanceScore,
        embedding,
      });
      for (const link of params.links ?? []) {
        await store.createLink({ fromId: entry.id, attributionType: 'USER_EXPLICIT', ...link });
      }
      return entry;
    },

    /** Link two memory entries with a typed edge (the host's own vocabulary). */
    link: (input: NewMemoryLink) => store.createLink(input),

    /** Links touching an entry — leaving it, arriving at it, or both (default). */
    listLinks: (filters: MemoryLinkFilters) => store.listLinks(filters),

    /**
     * Intention-ranked recall WITHOUT a full agent turn — the standalone read
     * verb (v0.2 item A). Embeds the query with the injected embedder, runs the
     * 6-signal intention rerank against the injected store, and returns the
     * surviving rows split into raw `entries` and derived `artifacts`, each
     * carrying its `intention` score. No LLM, no write-back — pure retrieval.
     * This un-traps `searchWithIntention`, previously reachable only inside
     * `runAgent`.
     *
     * - `limit` caps the hydrated rows (omit to return all survivors).
     * - `searchLimit` (default 8) is the per-table candidate pool before rerank.
     * - `explain` attaches `why` to each row: the score, the six signals, and the
     *   governing items (goal, sign, seed intent…) that boosted it. Same ranking.
     */
    recall: (
      contextId: string,
      query: string,
      opts?: { limit?: number; searchLimit?: number; explain?: boolean }
    ) =>
      recallEntriesAndArtifacts({
        userId,
        contextId,
        query,
        limit: opts?.limit,
        searchLimit: opts?.searchLimit,
        explain: opts?.explain,
        deps: { store, embeddings, intention },
      }),

    /**
     * Plain, unranked listing of raw memory entries — "what's in the box"
     * (v0.2 item A). Passes straight through to the injected store's filtered
     * query; no embedding, no rerank. Use `recall` when you want relevance.
     */
    listMemories: (filters: MemoryEntryFilters) => store.listMemoryEntries(filters),

    /**
     * Checkpoint — write a session-end `SUMMARY` artifact capturing "where we
     * left off" (v0.2 item C, carryover). The next `wake()` loads it first, so
     * the mind *resumes* instead of *restarts*. The summary is embedded (a real
     * derived artifact); it carries no source entries because it's a session
     * wrap-up, not a critic derivation from specific clues.
     */
    checkpoint: async (contextId: string, summary: string, opts?: { title?: string; confidence?: number }) => {
      const embedding = await embeddings.embed(summary);
      return store.createArtifact({
        contextId,
        type: 'SUMMARY',
        content: summary,
        title: opts?.title ?? null,
        confidence: opts?.confidence,
        embedding,
        sourceEntryIds: [],
      });
    },

    /**
     * Promote a derived belief so it rides the continuity packet across wakes
     * (`wake().promoted`) — v0.2 item C. Expressed through the schema's standing
     * signal: pins `consolidationScore` high. Standing, not kind — the artifact
     * stays a MemoryArtifact. Returns the updated artifact, or null if it does
     * not exist. (The refined auto-promotion + decay policy is v0.3.)
     */
    promote: (artifactId: string) => store.setArtifactConsolidation(artifactId, PROMOTION.PIN),

    /** Demote a belief — reset its standing to the consolidation base. Inverse of `promote`. */
    demote: (artifactId: string) => store.setArtifactConsolidation(artifactId, PROMOTION.BASE),

    /**
     * Tier-aware clear (v0.2 item D) — HARD-FORGET a context's episodic + derived
     * memory while the standing self survives: wipes all raw entries and all
     * non-SUMMARY artifacts (promoted beliefs included), KEEPS governing memory
     * (context / profile / goals) AND the carryover SUMMARY. A `wake()` after
     * this reconstructs identity + carryover from the surviving data — proving
     * continuity lives in the DATA, not a running loop (stateless ≠
     * discontinuous). A genuine forget, not the app-layer soft-delete/archive.
     */
    clear: (contextId: string) => store.clearContextMemory(contextId),

    /**
     * Wake — assemble the standing "state of mind" for a context BEFORE any
     * input (v0.2 item B). Pure call: composes the governing frame + foreground
     * (and, from item C, carryover + promoted) into a returnable
     * ContinuityState packet and forgets it. Cold-boot and re-wake are the same
     * call. This is the continuity door — continuity reconstructed from data,
     * not a live object kept warm (that is the v0.3 engine).
     */
    wake: (contextId: string, opts?: { focusQuery?: string }) =>
      assembleContinuityState({ userId, contextId, deps: { store, embeddings }, focusQuery: opts?.focusQuery }),

    /**
     * Step 1 of a guide turn — the reply. Recalls (with `why`), assembles the
     * prompt (root context first) and streams the
     * answer with the `reply` job. Returns `{ input, stream }`: `input` is
     * exactly what the guide was given; consume `stream` once for the text.
     * Lazily imported so importing the barrel pulls in nothing but types.
     */
    reply: async (contextId: string, message: string, opts?: TurnOptions) => {
      const { reply } = await import('@/lib/comind/agentRuntime/turn');
      return reply(userId, contextId, message, opts, { store, embeddings, llm, intention });
    },

    /**
     * Step 2 of a guide turn — extraction. Pass the `input` from `reply` and the
     * full reply text; distils decisions, insights, tasks… with the `extraction`
     * job and writes them back with provenance. The host decides when to run it.
     */
    extract: async (input: GuideInput, response: string) => {
      const { extract } = await import('@/lib/comind/agentRuntime/turn');
      return extract(input, response, { store, embeddings, llm, intention });
    },

    /**
     * A full turn without streaming — `reply` then `extract`. Returns
     * `{ response, trace, input }`.
     */
    runAgent: async (contextId: string, message: string, opts?: TurnOptions) => {
      const { runAgent } = await import('@/lib/comind/agentRuntime/turn');
      return runAgent(userId, contextId, message, opts, { store, embeddings, llm, intention });
    },

    // --- Governing memory: the person's direct edits (they apply immediately). ---

    /** Create a context. Pass `isRoot: true` for the one whose governing memory applies everywhere. */
    createContext: (input: NewContext) => store.createContext(input),
    updateContext: (id: string, patch: ContextPatch) => store.updateContext(id, patch),
    /**
     * Create a goal — something to complete, or (`standing: true`) an ongoing
     * value with no finish line. May carry `signs` and the ids of the goals it
     * `supports` (typically broader ones in an ancestor or the root context).
     */
    createGoal: (input: NewGoal) => store.createGoal(input),
    /**
     * Change a goal — title, priority (`weight`), status, `outranks`, `standing`,
     * `signs`, `supports`… Completing or pausing it drops it from the lens.
     */
    updateGoal: (id: string, patch: GoalPatch) => store.updateGoal(id, patch),
    /** All of a context's goals (any status, or only `status`). */
    listGoals: (contextId: string, status?: GoalStatus) => store.listGoals({ contextId, status }),
    createAgentProfile: (input: NewAgentProfile) => store.createAgentProfile(input),
    updateAgentProfile: (id: string, patch: AgentProfilePatch) => store.updateAgentProfile(id, patch),
    /** A context's watch words: `add(contextId, { text, priority, outranks })`, `update(id, patch)`, `remove(id)`. */
    watchWords: governingVerbs(store, 'watchWord'),
    /** The agent's directives for a context (its profile must exist) — same verbs as `watchWords`. */
    directives: governingVerbs(store, 'directive'),

    // --- The mind's part: it proposes; the person decides. ---

    /**
     * Draft goals (completable or standing, with signs and the broader goals
     * they support) and watch words from what the person said (a setup
     * conversation, a description…) with the `drafting` job. Nothing is stored:
     * show the drafts for approval, and keep any undecided ones with
     * `suggestions.add`. Knows the root context, the contexts above (`contextId`'s
     * ancestors, or `parentId` for a new one) and `contextId`'s own items, so it
     * doesn't repeat them. `include` also asks for an intent line and sub-areas.
     */
    draftGoverning: async (params: {
      about: DraftSubject; text: string; contextId?: string; parentId?: string | null;
      include?: { intent?: boolean; children?: boolean };
    }) => {
      const { draftGoverning } = await import('@/lib/comind/governance');
      return draftGoverning(params, { store, llm });
    },

    /** Governing changes the mind proposes, waiting for the person's OK. */
    suggestions: {
      add: (contextId: string, s: {
        kind: GoverningSuggestion['kind']; text: string; priority?: number; rationale?: string | null;
        standing?: boolean; supports?: string[];
      }) => store.createSuggestion({ ...s, contextId }),
      list: (contextId: string, status: GoverningSuggestion['status'] = 'pending') => store.listSuggestions(contextId, status),
      /** Apply it (optionally in the person's own words / priority), then mark it approved. */
      approve: async (id: string, edits?: { text?: string; priority?: number; outranks?: boolean; standing?: boolean; supports?: string[] }) => {
        const { approveSuggestion } = await import('@/lib/comind/governance');
        return approveSuggestion(id, edits, store);
      },
      reject: (id: string) => store.setSuggestionStatus(id, 'rejected'),
    },

    /**
     * Write (or refresh) the mind's own understanding of a context into
     * `Context.summary` with the `summary` job — from its frame, recent entries,
     * settled beliefs and its previous understanding. `seed` adds text the
     * person gave while setting the context up. The mind's, not governing
     * memory: it updates freely.
     */
    updateContextSummary: async (contextId: string, opts?: { seed?: string }) => {
      const { updateContextSummary } = await import('@/lib/comind/governance');
      return updateContextSummary({ contextId, seed: opts?.seed }, { store, llm });
    },
  };
}

/** The assembled CoMind instance — the public methods. */
export type Comind = ReturnType<typeof createComind>;
