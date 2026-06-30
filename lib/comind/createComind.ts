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

import type { MemoryStore, EmbeddingProvider, LLMProvider, NewContext, NewGoal, NewAgentProfile } from '@/lib/comind/providers';
import type { RunAgentContext } from '@/lib/comind/agentRuntime/types';
import type { MemoryType } from '@/lib/comind/types';

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
