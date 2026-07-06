/**
 * createComind — the public entry point. Assembles the three injected providers
 * into a single instance exposing the public methods.
 *
 * Prisma-free by construction: this module imports ONLY types (erased at
 * runtime). The runtime is pulled in via dynamic `import()` inside `runAgent`,
 * and every other method calls straight through to the injected providers. There
 * is NO built-in backend — a consumer embeds CoMind by implementing the three
 * provider interfaces (MemoryStore, EmbeddingProvider, LLMProvider) and passing
 * them in, so nothing Prisma/HuggingFace/OpenAI loads unless their own providers
 * pull it in. This is the "no lock-in" guarantee the demo proves (demo:prove).
 *
 * `userId` is a transitional tenant tag threaded into the runtime; non-tenant
 * stores (e.g. the in-memory reference store) ignore it.
 */

import type { MemoryStore, EmbeddingProvider, LLMProvider, NewContext, NewGoal, NewAgentProfile, MemoryEntryFilters } from '@/lib/comind/providers';
import type { RunAgentContext } from '@/lib/comind/agentRuntime/types';
import type { MemoryType } from '@/lib/comind/types';
import { recallEntriesAndArtifacts } from '@/lib/comind/contextRecall';
import { assembleContinuityState } from '@/lib/comind/continuity';

export interface CreateComindConfig {
  /** Transitional tenant tag threaded into the runtime; non-tenant stores ignore it. */
  userId: string;
  /** Persistence + retrieval. Required — there is no default backend. */
  store: MemoryStore;
  /** Text → vector. Required — there is no default backend. */
  embeddings: EmbeddingProvider;
  /** Structured output over a CoMind-owned schema. Required — there is no default backend. */
  llm: LLMProvider;
}

export function createComind(config: CreateComindConfig) {
  const { userId, store, embeddings, llm } = config;

  return {
    /**
     * Store a raw observation: embed its content with the injected embedder, then
     * persist it through the injected store. The cognitive loop (`runAgent`) does
     * this for the critic's conclusions; this is the host's hook for raw inputs.
     */
    storeMemory: async (params: {
      contextId: string;
      content: string;
      type?: MemoryType;
      tags?: string[];
      sourceType?: string;
      importanceScore?: number;
    }) => {
      const embedding = await embeddings.embed(params.content);
      return store.createMemoryEntry({
        contextId: params.contextId,
        type: params.type ?? 'NOTE',
        content: params.content,
        tags: params.tags,
        sourceType: params.sourceType,
        importanceScore: params.importanceScore,
        embedding,
      });
    },

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
     */
    recall: (
      contextId: string,
      query: string,
      opts?: { limit?: number; searchLimit?: number }
    ) =>
      recallEntriesAndArtifacts({
        userId,
        contextId,
        query,
        limit: opts?.limit,
        searchLimit: opts?.searchLimit,
        deps: { store, embeddings },
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
     * The CAMA loop: recall → assemble prompt → LLM → memory critic (write-back).
     * Returns `{ response, trace }` — the trace is the inspectable record of what
     * was recalled, produced, and reinforced. Lazily imported so merely importing
     * the barrel pulls in nothing but types.
     */
    runAgent: async (contextId: string, userMessage: string, context?: RunAgentContext) => {
      const { runAgent } = await import('@/lib/comind/agentRuntime/runAgent');
      return runAgent(userId, contextId, userMessage, context, { store, embeddings, llm });
    },

    createContext: (input: NewContext) => store.createContext(input),
    createGoal: (input: NewGoal) => store.createGoal(input),
    createAgentProfile: (input: NewAgentProfile) => store.createAgentProfile(input),
  };
}

/** The assembled CoMind instance — the public methods. */
export type Comind = ReturnType<typeof createComind>;
