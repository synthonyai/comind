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

  // Beat 1 — wake without a query. Cold boot: the frame is there, but there is
  // no thread yet (carryover empty), because nothing has been left off.
  console.log("══ COLD BOOT ══  (nothing asked yet — the mind is about to wake)");
  const cold = await comind.wake(ctxId);
  console.log(renderContinuityState(cold));

  // ...a session happens (the detective works the case)... then, at session end,
  // the host writes a checkpoint capturing where it left off.
  console.log(
    "\n\n── … session runs, then CHECKPOINT ──  (write 'where we left off' at session end)"
  );
  await comind.checkpoint(
    ctxId,
    "Was working the butler angle; still need to confirm who held the cellar key before naming a suspect.",
    { title: "Dispatch 1 — left off" }
  );

  // Beat 2 — re-wake. The SUMMARY is loaded FIRST: the mind resumes, it doesn't
  // restart. Nothing was kept warm between the two wakes — the thread was
  // reconstructed from the stored SUMMARY.
  console.log("\n── RE-WAKE ──  (carryover is loaded first — resume, not restart)");
  const rewake = await comind.wake(ctxId);
  console.log(renderContinuityState(rewake));

  const frameHeld =
    rewake.governing.context?.id === cold.governing.context?.id &&
    rewake.foreground.activeGoals.length === cold.foreground.activeGoals.length;
  const resumed = rewake.carryover.summary !== null && cold.carryover.summary === null;
  const ok = frameHeld && resumed;
  console.log(
    `\n${ok ? "✅" : "❌"} the frame held AND the carryover surfaced — the wake reconstructed a ` +
      `resumable standing state from the DATA, no engine running.`
  );
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
