/**
 * Activation characterization (Bucket B — the living loop, write side)
 * --------------------------------------------------------------------------
 * Pins the reinforcement rule: activating a recalled memory/artifact must
 * strengthen its operational signals by the documented amounts and clamp at 1.
 * That rule lives in `nextActivation` (exported from the barrel) and every
 * `MemoryStore` must apply it in `activateEntries` / `activateArtifacts`; here we
 * verify the in-memory reference store honors it.
 *
 * Prisma-free port of the private `activation-oracle.ts`. Assertion-based — the
 * arithmetic is fully deterministic (no embeddings, no LLM).
 *
 *   accessScore        += 0.1 per activation           (cap 1)
 *   consolidationScore  = 0.3 + activationCount * 0.05  (cap 1)
 *   activationCount     += 1
 *
 * Usage: npm run characterize:activation
 */

import { ACTIVATION } from "@/lib/comind";
import { InMemoryMemoryStore } from "@/demo/inMemoryStore";
import { makeChecker } from "@/characterization/stubs";

async function main() {
  const { check, checkTrue, report } = makeChecker("activation");
  const store = new InMemoryMemoryStore();

  const ctx = await store.createContext({ name: "Activation Context" });
  const entry = await store.createMemoryEntry({
    contextId: ctx.id,
    type: "NOTE",
    content: "A memory that will be used.",
  });
  const artifact = await store.createArtifact({
    contextId: ctx.id,
    type: "INSIGHT",
    content: "A conclusion that will be re-used.",
    sourceEntryIds: [],
  });

  const readEntry = async () => (await store.getMemoryEntry(entry.id))!;
  const readArtifact = async () => (await store.getArtifact(artifact.id))!;

  // --- Defaults at creation -------------------------------------------------
  const start = await readEntry();
  console.log("[activation] defaults at creation:");
  check("accessScore default", start.accessScore, 0.5);
  check("consolidationScore default", start.consolidationScore, ACTIVATION.CONSOLIDATION_BASE);
  check("activationCount default", start.activationCount, 0);
  checkTrue("lastActivatedAt unset", start.lastActivatedAt === null);

  // --- First activation -----------------------------------------------------
  const n1 = await store.activateEntries([entry.id]);
  check("activateEntries reports 1 row", n1, 1);
  const a1 = await readEntry();
  console.log("[activation] after 1st activation:");
  check("activationCount", a1.activationCount, 1);
  check("accessScore (+0.1)", a1.accessScore, 0.6);
  check("consolidationScore (0.3 + 1*0.05)", a1.consolidationScore, 0.35);
  checkTrue("lastActivatedAt set", a1.lastActivatedAt !== null);

  // --- Second activation: monotonic growth ----------------------------------
  await store.activateEntries([entry.id]);
  const a2 = await readEntry();
  console.log("[activation] after 2nd activation:");
  check("activationCount", a2.activationCount, 2);
  check("accessScore (+0.1 again)", a2.accessScore, 0.7);
  check("consolidationScore (0.3 + 2*0.05)", a2.consolidationScore, 0.4);

  // --- Clamp at 1: drive both signals to saturation -------------------------
  // No field-setter on the interface, so we saturate by repeated activation.
  // accessScore caps after 5 activations; consolidation caps at 14 (0.3+14*.05).
  for (let i = 0; i < 12; i++) await store.activateEntries([entry.id]); // now 14 total
  const capped = await readEntry();
  console.log("[activation] after activation at saturation (14 total):");
  check("activationCount", capped.activationCount, 14);
  check("accessScore clamped to 1", capped.accessScore, 1);
  check("consolidationScore clamped to 1", capped.consolidationScore, 1);

  // --- No-op on empty input -------------------------------------------------
  check("empty ids updates 0 rows", await store.activateEntries([]), 0);

  // --- Artifacts reinforce by the SAME rule (Bucket C / P3) -----------------
  const artStart = await readArtifact();
  console.log("[activation] artifact defaults at creation:");
  check("artifact accessScore default", artStart.accessScore, 0.5);
  check("artifact consolidationScore default", artStart.consolidationScore, ACTIVATION.CONSOLIDATION_BASE);
  check("artifact activationCount default", artStart.activationCount, 0);
  checkTrue("artifact lastActivatedAt unset", artStart.lastActivatedAt === null);

  check("activateArtifacts reports 1 row", await store.activateArtifacts([artifact.id]), 1);
  const art1 = await readArtifact();
  console.log("[activation] artifact after 1st activation:");
  check("artifact activationCount", art1.activationCount, 1);
  check("artifact accessScore (+0.1)", art1.accessScore, 0.6);
  check("artifact consolidationScore (0.3 + 1*0.05)", art1.consolidationScore, 0.35);
  checkTrue("artifact lastActivatedAt set", art1.lastActivatedAt !== null);

  check("artifact empty ids updates 0 rows", await store.activateArtifacts([]), 0);

  report();
}

main().catch((e) => {
  console.error("[activation] error:", e);
  process.exitCode = 1;
});
