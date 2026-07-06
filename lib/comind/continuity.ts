// lib/comind/continuity.ts
//
// The continuity assembler (v0.2 item B) — the "wake" door.
//
// `assembleContinuityState` is a PURE FUNCTION: given a context and the injected
// store, it composes the standing "current state of mind" and RETURNS it as a
// packet. It owns nothing, runs nothing, keeps nothing warm. Wake is simply the
// event of calling it; cold-boot (from nothing) and re-wake (call it again) are
// the same call — the difference is only what data the store already holds.
//
// This is the seam that lets continuity be *reconstructed*, not *kept running*:
// continuity lives in the DATA (governing frame, carryover, promoted beliefs),
// and this function reconstitutes it on demand. The thing that would keep the
// packet warm and re-run itself over time is the ENGINE (v0.3) — deliberately
// NOT here.
//
// The packet has four components (by *why* each is present):
//   1. governing  — constitutive; loaded by rule (Context + AgentProfile + Goals)
//   2. foreground — where the mind is pointed now (this context + active goals)
//   3. carryover  — unfinished business ("where we left off")   [SLOT — item C]
//   4. promoted   — derived beliefs that earned standing        [SLOT — item C]
//
// #1–2 are the *frame* (present by rule) and are fully assembled here. #3–4 are
// the *selection* (present by earning it); their real content needs a
// session-end SUMMARY write + a promotion marker, both of which land in v0.2
// item C. Until then they are wired as honest empty slots, so the packet shape
// is complete and the two ingredients drop in without a rewrite. (When #3–4
// carry real content, assembly becomes a selection under a budget — see
// agentRuntime/tokenBudget.ts — but there is nothing to trim while they're empty.)

import type { MemoryStore, EmbeddingProvider } from '@/lib/comind/providers';
import type { AgentProfile, Context, Goal, MemoryEntry, MemoryArtifact } from '@/lib/comind/types';

/**
 * The governing/foreground frame: the by-rule reads shared by the continuity
 * assembler and the agent runtime (`agentRuntime/dataFetcher.ts`). Factored here
 * so both compose from ONE path — no duplicate store reads, no drift.
 */
export async function loadFrame(
  store: MemoryStore,
  contextId: string
): Promise<{ agent: AgentProfile | null; context: Context | null; goals: Goal[] }> {
  const [agent, context, goals] = await Promise.all([
    store.getAgentProfileForContext(contextId),
    store.getContext(contextId),
    store.listGoals({ contextId, status: 'ACTIVE' }),
  ]);
  return { agent, context, goals };
}

/** The assembled standing state — the return value of a wake. */
export interface ContinuityState {
  contextId: string;

  /** #1 Governing memory — constitutive; present by rule, not earned. */
  governing: {
    agentProfile: AgentProfile | null;
    context: Context | null;
  };

  /** #2 Foreground — where the mind is pointed now. */
  foreground: {
    contextId: string;
    activeGoals: Goal[];
  };

  /**
   * #3 Carryover — "where we left off". SLOT: real load (latest session-end
   * SUMMARY artifact) lands in v0.2 item C.
   */
  carryover: {
    summary: MemoryArtifact | null;
  };

  /**
   * #4 Promoted derived memory — beliefs that earned standing. SLOT: the
   * promotion marker + "promotable top-N" query land in v0.2 item C.
   */
  promoted: {
    entries: MemoryEntry[];
    artifacts: MemoryArtifact[];
  };
}

/**
 * Assemble the continuity state for a context — the pure wake function.
 *
 * - `userId` / `focusQuery` are part of the item-C-ready signature: `userId`
 *   scopes tenant recall and `focusQuery` will seed the "currently relevant"
 *   promoted slice. Neither is consumed yet (the frame is context-scoped and the
 *   selection slots are empty).
 * - `deps.store` is required — the library ships no default backend.
 */
export async function assembleContinuityState(params: {
  userId: string;
  contextId: string;
  deps: { store?: MemoryStore; embeddings?: EmbeddingProvider };
  focusQuery?: string;
}): Promise<ContinuityState> {
  const { contextId, deps } = params;
  const store = deps?.store;
  if (!store) throw new Error('CoMind: assembleContinuityState requires an injected MemoryStore (no default backend).');

  const { agent, context, goals } = await loadFrame(store, contextId);

  return {
    contextId,
    governing: { agentProfile: agent, context },
    foreground: { contextId, activeGoals: goals },
    // SLOT — item C wires the session-end SUMMARY load here.
    carryover: { summary: null },
    // SLOT — item C adds the promotion marker + "promotable top-N" query here.
    promoted: { entries: [], artifacts: [] },
  };
}
