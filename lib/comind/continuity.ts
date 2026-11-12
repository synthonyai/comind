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
//   1. governing  — constitutive; loaded by rule (Context + AgentProfile + Goals),
//                   plus the ROOT context's, which applies everywhere
//   2. foreground — where the mind is pointed now (this context + active goals)
//   3. carryover  — unfinished business ("where we left off")   [SLOT — item C]
//   4. promoted   — derived beliefs that earned standing        [SLOT — item C]
//
// #1–2 are the *frame* (present by rule) and are fully assembled here. #3–4 are
// the *selection* (present by earning it); their real content needs a
// session-end SUMMARY write + promotion (expressed through consolidationScore),
// both of which land in v0.2 item C. Until then they are empty slots, so the packet shape
// is complete and the two ingredients drop in without a rewrite. (When #3–4
// carry real content, assembly becomes a selection under a budget — see
// agentRuntime/tokenBudget.ts — but there is nothing to trim while they're empty.)

import type { MemoryStore, EmbeddingProvider } from '@/lib/comind/providers';
import type { AgentProfile, Context, Goal, MemoryArtifact } from '@/lib/comind/types';
import { ACTIVATION } from '@/lib/comind/activation';

/**
 * Promotion policy-lite for v0.2. Promotion is expressed through the schema's
 * standing signal (`consolidationScore`), not a separate marker: a derived
 * belief at/above `THRESHOLD` is "promoted" and rides the continuity packet.
 * `PIN` is what an explicit `promote()` sets; `demote()` resets to the schema's
 * consolidation base. The refined auto-promotion + decay-driven demotion policy
 * is v0.3.
 */
export const PROMOTION = {
  /** consolidationScore at/above which a belief rides the packet. */
  THRESHOLD: 0.6,
  /** consolidationScore an explicit promote() pins to. */
  PIN: 0.9,
  /** consolidationScore an explicit demote() resets to (the schema base). */
  BASE: ACTIVATION.CONSOLIDATION_BASE,
} as const;

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

/** A governing frame: the context, its agent profile, and its active goals. */
export interface Frame {
  agent: AgentProfile | null;
  context: Context | null;
  goals: Goal[];
}

/**
 * The ROOT frame — the governing memory that applies in every context (the
 * store's top-level context, `parentId === null`). Returns null when there is
 * no root, or when `contextId` IS the root (its frame is already the main one).
 */
export async function loadRootFrame(store: MemoryStore, contextId: string): Promise<(Frame & { contextId: string }) | null> {
  const rootId = await store.getRootContextId();
  if (!rootId || rootId === contextId) return null;
  return { contextId: rootId, ...(await loadFrame(store, rootId)) };
}

/** The assembled standing state — the return value of a wake. */
export interface ContinuityState {
  contextId: string;

  /** #1 Governing memory — constitutive; present by rule, not earned. */
  governing: {
    agentProfile: AgentProfile | null;
    context: Context | null;
    /**
     * The root context's governing memory — applies in every context and comes
     * first. Null when there is no root or when this context IS the root.
     */
    root: {
      contextId: string;
      agentProfile: AgentProfile | null;
      context: Context | null;
      activeGoals: Goal[];
    } | null;
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
   * #4 Promoted derived memory — the "sticky" beliefs that earned standing and
   * ride the packet across wakes (v0.2 item C). Derived-only by design: raw
   * entries are not promoted. Ordered by standing; re-evaluated each wake (the
   * promote/demote policy itself is v0.3).
   */
  promoted: {
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

  const [{ agent, context, goals }, root, summary, promotedArtifacts] = await Promise.all([
    loadFrame(store, contextId),
    loadRootFrame(store, contextId),
    // Carryover — the session-end SUMMARY, loaded FIRST at wake by rule (v0.2
    // item C). "Where we left off" — makes a wake *resume* instead of *restart*.
    store.getLatestSummary(contextId),
    // Promoted — the "sticky" beliefs, top-N by standing (consolidationScore >=
    // threshold) (v0.2 item C).
    store.listPromotedArtifacts(contextId, PROMOTION.THRESHOLD),
  ]);

  return {
    contextId,
    governing: {
      agentProfile: agent,
      context,
      root: root ? { contextId: root.contextId, agentProfile: root.agent, context: root.context, activeGoals: root.goals } : null,
    },
    foreground: { contextId, activeGoals: goals },
    carryover: { summary },
    promoted: { artifacts: promotedArtifacts },
  };
}
