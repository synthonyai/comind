/**
 * demo/wake.ts — the v0.2 "waking-up" demo, beat 1 ("wake without a query").
 *
 * Cold-boots the same robot-detective world the v0.1 demo uses, then — before
 * any input — CALLS `comind.wake()` and renders the assembled continuity state.
 * Then it re-wakes to show the standing state reconstructs identically: the
 * "stateless ≠ discontinuous" beat, in narrated form. No loop runs; the packet
 * is recomputed from the data each wake.
 *
 * Runs on the in-memory store + stubs, so it needs no keys and stays inside the
 * clean boundary. Later beats (carryover / promotion / soft-membership / the
 * clear-button money-shot) fill the slots this pane already renders.
 *
 * Run: npm run demo:wake
 */

import { createComind } from "@/lib/comind";
import { InMemoryMemoryStore } from "@/demo/inMemoryStore";
import { StubEmbeddings, ScriptedLLM } from "@/demo/stubProviders";
import { seedWorld } from "@/demo/seedWorld";
import { robotDetective } from "@/demo/scenarios/robotDetective";
import { renderContinuityState } from "@/demo/renderContinuityState";

async function main() {
  const store = new InMemoryMemoryStore();
  const embeddings = new StubEmbeddings();
  const llm = new ScriptedLLM();

  // Host setup: seed the world through the store (no agent turn yet).
  const { ctxId } = await seedWorld(store, embeddings, robotDetective.world);
  const comind = createComind({ userId: "demo", store, embeddings, llm });

  console.log("══ COLD BOOT ══  (nothing asked yet — the mind is about to wake)");
  const state = await comind.wake(ctxId);
  console.log(renderContinuityState(state));

  console.log(
    "\n\n── RE-WAKE ──  (call wake() again — nothing was kept warm; it rebuilds from data)"
  );
  const again = await comind.wake(ctxId);
  console.log(renderContinuityState(again));

  const sameFrame =
    again.governing.context?.id === state.governing.context?.id &&
    again.foreground.activeGoals.length === state.foreground.activeGoals.length;
  console.log(
    `\n${sameFrame ? "✅" : "❌"} re-wake reconstructed the same standing state — continuity ` +
      `lives in the DATA, not a running process.`
  );
  process.exit(sameFrame ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
