/**
 * demo/wake.ts — the v0.2 "waking-up" demo (narrated-transcript cut).
 *
 * Cold-boots the same robot-detective world the v0.1 demo uses, then — before
 * any input — CALLS `comind.wake()` and renders the assembled continuity state.
 * Walks the full v0.2 beat list, each recomputed from the data (no loop runs):
 *   1. wake without a query        — the packet assembles before any input
 *   2. carryover                   — a session-end SUMMARY is loaded first
 *   3. promotion                   — a sticky belief rides the packet, then demotes
 *   4. soft-membership recall      — a foreign-context memory surfaces (demoted)
 *   money-shot: clear()            — hard-forget episodic+derived, then re-wake
 *                                    into the full standing self (stateless ≠
 *                                    discontinuous)
 *
 * Runs on the in-memory store + stubs, so it needs no keys and stays inside the
 * clean boundary.
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

  // Beat 3 — a belief that sticks (promotion). The detective reaches a durable
  // conclusion; the host promotes it. It then rides the packet across wakes —
  // and can later demote.
  console.log(
    "\n\n── … a conclusion forms, then PROMOTE ──  (mark a derived belief 'sticky')"
  );
  const belief = await store.createArtifact({
    contextId: ctxId,
    type: "DECISION",
    content: "The cellar key never leaves the housekeeper — treat it as a standing constraint.",
    title: "Cellar key stays with the housekeeper",
    confidence: 0.9,
    embedding: await embeddings.embed("cellar key housekeeper standing constraint"),
    sourceEntryIds: [],
  });
  await comind.promote(belief.id);

  console.log("\n── WAKE (belief promoted) ──  (it now rides the standing state)");
  const withBelief = await comind.wake(ctxId);
  console.log(renderContinuityState(withBelief));
  const promotedRode = withBelief.promoted.artifacts.some((a) => a.id === belief.id);

  console.log("\n── … re-evaluated, then DEMOTE ──  (standing can be revoked)");
  await comind.demote(belief.id);
  const afterDemote = await comind.wake(ctxId);
  const demotedGone = !afterDemote.promoted.artifacts.some((a) => a.id === belief.id);
  console.log(
    `   promoted slice: ${withBelief.promoted.artifacts.length} belief(s) → ${afterDemote.promoted.artifacts.length} after demote`
  );

  // Beat 4 — soft-membership recall (context = foreground, not box). A memory
  // filed under ANOTHER context still surfaces on recall here, ranked below the
  // own-context memory (the same-context boost demotes it, it isn't excluded).
  console.log(
    "\n\n── … a NEIGHBOURING context exists, then RECALL ──  (context is a lens, not a box)"
  );
  const harbor = await store.createContext({
    name: "Harbor logistics",
    seedIntent: "Track cargo movements at the harbor.",
  });
  // Same fact filed in both contexts — so base relevance is equal and the
  // same-context boost is the ONLY differentiator (isolates the beat cleanly).
  const fact = "The crate left the dock on the night ferry.";
  await store.createMemoryEntry({ contextId: ctxId, type: "NOTE", content: fact, embedding: await embeddings.embed(fact) });
  await store.createMemoryEntry({ contextId: harbor.id, type: "NOTE", content: fact, embedding: await embeddings.embed(fact) });

  const hits = await comind.recall(ctxId, "what happened to the crate at the dock?");
  console.log("   recall('what happened to the crate at the dock?') from the case context:");
  for (const e of hits.entries) {
    const where = e.contextId === ctxId ? "own" : "OTHER-ctx";
    console.log(`     ● [${where}] “${e.content}”  (intent ${e.intention.toFixed(2)})`);
  }
  const ownHit = hits.entries.find((e) => e.contextId === ctxId);
  const foreignHit = hits.entries.find((e) => e.contextId === harbor.id);
  const softMembership =
    !!ownHit && !!foreignHit &&
    hits.entries.findIndex((e) => e.id === ownHit.id) < hits.entries.findIndex((e) => e.id === foreignHit.id);

  // ── MONEY-SHOT — the clear button (proves stateless ≠ discontinuous) ──────
  // Re-promote the belief so the state is rich before the wipe: a sticky belief
  // rides the packet, a carryover SUMMARY is present, and there are raw episodic
  // entries in the case context.
  await comind.promote(belief.id);
  console.log("\n\n══ FULL STANDING STATE ══  (identity · carryover · a promoted belief · raw episodic memory)");
  const before = await comind.wake(ctxId);
  console.log(renderContinuityState(before));
  const beforeEntries = await comind.listMemories({ contextId: ctxId });

  // HARD-FORGET: wipe the episodic + derived tiers. Governing (context / profile
  // / goals) and the carryover SUMMARY survive by rule. No loop runs.
  console.log(
    "\n── 🧹 clear() ──  (hard-forget episodic + derived; governing + carryover survive)"
  );
  const removed = await comind.clear(ctxId);
  console.log(
    `   removed ${removed.entries} episodic entr${removed.entries === 1 ? "y" : "ies"} + ` +
      `${removed.artifacts} derived artifact(s) — governing frame + carryover SUMMARY left intact.`
  );

  // Re-wake from the surviving data alone. The standing state RECONSTRUCTS:
  // identity + carryover come back, the promoted belief + raw entries are gone.
  console.log("\n── RE-WAKE (after clear) ──  (standing state reconstructs from DATA, no engine ran)");
  const after = await comind.wake(ctxId);
  console.log(renderContinuityState(after));
  const afterEntries = await comind.listMemories({ contextId: ctxId });

  const moneyShot =
    // before: a genuinely rich state, so the wipe is meaningful
    before.promoted.artifacts.length > 0 &&
    before.carryover.summary !== null &&
    beforeEntries.length > 0 &&
    // governing survived (same identity + same active-goal set)
    after.governing.context?.id === before.governing.context?.id &&
    after.governing.agentProfile?.id === before.governing.agentProfile?.id &&
    after.foreground.activeGoals.length === before.foreground.activeGoals.length &&
    // carryover survived — the SAME SUMMARY thread, reconstructed on wake
    after.carryover.summary?.id === before.carryover.summary?.id &&
    // episodic + derived were forgotten
    after.promoted.artifacts.length === 0 &&
    afterEntries.length === 0 &&
    removed.entries === beforeEntries.length &&
    removed.artifacts >= 1;

  const ok = frameHeld && resumed && promotedRode && demotedGone && softMembership && moneyShot;
  console.log(
    `\n${ok ? "✅" : "❌"} frame held · carryover resumed · a promoted belief rode the packet and ` +
      `then demoted · a neighbouring-context memory surfaced (demoted, not excluded) · clear() ` +
      `hard-forgot episodic+derived yet the mind woke back into its full standing self — the whole ` +
      `standing state was reconstructed from DATA each wake, no engine running.`
  );
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
