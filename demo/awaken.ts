/**
 * demo/awaken.ts — "The Mind That Wakes" (v0.2 panel-centric demo).
 *
 * Stages docs/DemoScript_v0.2.md: Iris, a research assistant, on the AWAKE panel.
 * The panel is the star; PRIORITIZATION is the centerpiece (you declare today's
 * focus and the whole pile re-ranks by the intention lens — the beat a memory file
 * can't fake); the wipe (`clear()` → re-wake → still herself) is the closer.
 *
 * Two modes:
 *   • default  — auto-plays every beat with narration + panel renders + ASSERTIONS,
 *                exits 0/1 (CI-safe, like demo:wake). Runs on the in-memory store +
 *                stubs (no keys). `--pace <ms>` sets the per-beat dwell.
 *   • --step   — clears + redraws the panel each beat and waits for a keypress, so
 *                you drive it ([w]/[c]/enter). The "press the button" experience.
 *
 * Honest caveat: under the offline stub the re-rank lands on word-overlap; the
 * showcase run uses real embeddings so it lands on meaning (see the script's ledger).
 *
 * Run: npm run demo:awaken   ·   npm run demo:awaken -- --step
 */

import { createComind } from "@/lib/comind";
import { InMemoryMemoryStore } from "@/demo/inMemoryStore";
import { StubEmbeddings, ScriptedLLM } from "@/demo/stubProviders";
import { renderAwakePanel, type AwakeView, type AwakeRow } from "@/demo/renderAwakePanel";

const STEP = process.argv.includes("--step");
const paceArg = process.argv.indexOf("--pace");
const PACE = paceArg >= 0 ? Number(process.argv[paceArg + 1]) : STEP ? 0 : 700;

const embeddings = new StubEmbeddings();
const store = new InMemoryMemoryStore();
const llm = new ScriptedLLM();
const comind = createComind({ userId: "demo", store, embeddings, llm });

// ── little stage helpers ────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** In --step mode, wait for a keypress; otherwise dwell for the pace. */
async function beat(prompt: string): Promise<void> {
  if (!STEP) {
    if (prompt) console.log(`\n${prompt}`);
    await sleep(PACE);
    return;
  }
  process.stdout.write(`\n${prompt}  `);
  await new Promise<void>((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.once("data", (d) => {
      stdin.setRawMode?.(false);
      stdin.pause();
      // Ctrl-C still exits.
      if (d.toString() === "") process.exit(130);
      resolve();
    });
  });
}

function say(who: string, line: string) {
  console.log(`   ${who}: ${line}`);
}
function narrate(line: string) {
  console.log(`   › ${line}`);
}

/** Redraw the panel (clear screen in step mode so it reads as one living panel). */
function show(view: AwakeView, heading: string) {
  if (STEP) console.clear();
  console.log(`\n══ ${heading} ══`);
  console.log(renderAwakePanel(view));
}

// ── build the panel view from real reads (wake + recall) ────────────────────
const SCOPE = "infra";

async function buildView(
  ctxId: string,
  focusQuery: string,
  opts: { banner?: string; limit?: number } = {}
): Promise<AwakeView> {
  const [state, hits] = await Promise.all([
    comind.wake(ctxId),
    comind.recall(ctxId, focusQuery, { searchLimit: 20, limit: opts.limit ?? 8 }),
  ]);

  const surfacedNow: AwakeRow[] = hits.entries.map((e) => ({
    content: e.content,
    weight: e.intention, // LIVE relevance — the mover
    confidence: e.confidence,
    stability: e.consolidationScore,
    scope: e.contextId === ctxId ? SCOPE : "other",
    own: e.contextId === ctxId,
  }));

  const ridingWithMe: AwakeRow[] = state.promoted.artifacts.map((a) => ({
    content: a.title ?? a.content,
    weight: a.consolidationScore, // standing = why it rides
    confidence: a.confidence,
    stability: a.consolidationScore,
    scope: SCOPE,
    own: true,
  }));

  const goals = state.foreground.activeGoals;
  const maxW = Math.max(...goals.map((g) => g.weight), 0);
  const focus = goals
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .map((g) => ({
      title: g.title,
      weight: g.weight,
      lead: g.weight === maxW && maxW > 0,
      standDown: g.weight <= 0.15,
    }));

  return {
    name: state.governing.agentProfile?.name ?? "IRIS",
    directives: state.governing.agentProfile?.directives ?? [],
    values: state.governing.context?.values ?? [],
    ridingWithMe,
    surfacedNow,
    focus,
    leftOff: state.carryover.summary?.content ?? null,
    banner: opts.banner,
  };
}

// ── the world (Iris, mid-decision, across sittings) ─────────────────────────
async function seed() {
  const ctx = await store.createContext({
    name: "Infra decision",
    seedIntent: "Help choose our infra approach on solid evidence.",
    values: ["evidence over recency"],
  });
  await store.createAgentProfile({
    homeContextId: ctx.id,
    name: "IRIS",
    directives: ["ground every claim in a source", "flag assumptions"],
    watchWords: [],
  });
  const gStorage = await store.createGoal({
    contextId: ctx.id,
    title: "Choose a storage approach within our latency budget",
    weight: 0.8,
  });
  const gCost = await store.createGoal({
    contextId: ctx.id,
    title: "Know the real cost at 10x scale",
    weight: 0.6,
  });

  // Findings from prior sittings. storeMemory seeds importanceScore by
  // goal-alignment (item E) against the CURRENT goals (storage/cost) — so the
  // reliability findings intentionally seed low; the live lens lifts them later.
  const findings = [
    "Latency is fine on the managed option, well within our budget.",
    "Cost climbs steeply past 5x scale on the managed plan.",
    "The managed database had two outages last quarter — a serious reliability risk, and that outage history is our weak point.",
    "Self-hosting means owning our own failover to keep reliability high.",
  ];
  const ids: string[] = [];
  for (const content of findings) {
    const e = await comind.storeMemory({ contextId: ctx.id, content, attributionType: "USER_EXPLICIT" });
    ids.push(e.id);
  }

  // A prior session left off here (carryover).
  await comind.checkpoint(
    ctx.id,
    "Leaning toward the managed option — still need the real cost numbers at scale before committing.",
    { title: "left off" }
  );

  return { ctxId: ctx.id, gStorage: gStorage.id, gCost: gCost.id, outageId: ids[2] };
}

// ── the play ────────────────────────────────────────────────────────────────
async function main() {
  const checks: { name: string; ok: boolean }[] = [];
  const check = (name: string, ok: boolean) => checks.push({ name, ok });

  const { ctxId, gStorage, gCost, outageId } = await seed();

  // PROLOGUE
  if (STEP) console.clear();
  console.log("\n(nothing is awake — no process running, only what was written down)");
  await beat("press [w] to WAKE");

  // ACT ONE — wakes up already concentrating on the storage task.
  const v1 = await buildView(ctxId, "storage approach latency cost budget scale");
  show(v1, "ACT ONE · she wakes as someone (no query asked)");
  narrate("You asked nothing. She woke mid-task — storage findings ranked under that focus.");
  const topAct1 = v1.surfacedNow[0]?.content ?? "";
  check("act1: a storage/latency finding leads the focus", /latency|cost/i.test(topAct1));
  check("act1: carryover present (where she left off)", v1.leftOff !== null);

  await beat('type: "Drop storage — reliability is today\'s focus, above everything." [enter]');

  // ACT TWO — the centerpiece. A high-weight priority takes over; the pile re-ranks.
  const gReliability = await store.createGoal({
    contextId: ctxId,
    title: "Defend the reliability and outage history for the investor demo",
    weight: 1.0,
  });
  await store.updateGoal(gStorage, { weight: 0.1 }); // stood down, not deleted
  await store.updateGoal(gCost, { weight: 0.1 });

  // The PROOF: a NEUTRAL query. She answers through the new priority anyway,
  // because it's now part of the lens — not a sentence in the chat.
  const v2 = await buildView(ctxId, "what should I look at first");
  show(v2, "ACT TWO · you changed what matters — the whole pile re-ranks");
  const topAct2 = v2.surfacedNow[0];
  const latencyRow = v2.surfacedNow.find((r) => /latency/i.test(r.content));
  check("act2: a reliability finding is now on top", /reliability|outage/i.test(topAct2?.content ?? ""));
  check(
    "act2: the reliability finding out-weighs the latency finding (the lens, not the query)",
    !!latencyRow && (topAct2?.weight ?? 0) > latencyRow.weight
  );
  narrate("You asked something neutral — never said 'reliability'.");
  say("IRIS", "Start with the outage history — that's exactly where they'll press, and it's your weak point.");
  narrate("A plain model with a memory file can't do that — it has no standing weight to re-rank with.");

  // Pillar 4: the outage conclusion hardens BECAUSE it keeps getting used.
  const belief = await store.createArtifact({
    contextId: ctxId,
    type: "DECISION",
    content: "Managed's real weakness is reliability — lead the defense with the outage history.",
    title: "Managed's real weakness is reliability",
    confidence: 0.85,
    embedding: await embeddings.embed("managed reliability outage weakness defense"),
    sourceEntryIds: [outageId],
  });
  for (let i = 0; i < 7; i++) await store.activateArtifacts([belief.id]); // leaned on → S climbs past the promote line
  await beat("press [w] to WAKE (next morning)");

  // The belief has hardened across the wake — it rode into RIDING WITH ME.
  const v3 = await buildView(ctxId, "what should I look at first");
  show(v3, "ACT TWO · a belief that hardened because you used it now rides with her");
  check("act2: the hardened belief crossed into RIDING WITH ME", v3.ridingWithMe.length >= 1);
  narrate("That belief wasn't declared — it rose because you kept using it. Now it rides every waking.");

  await beat("press [c] to CLEAR — take her memory away");

  // ACT THREE — the gasp. Wipe episodic + derived; the self + priority + carryover survive.
  const beforeEntries = await comind.listMemories({ contextId: ctxId });
  const removed = await comind.clear(ctxId);
  const afterEntries = await comind.listMemories({ contextId: ctxId });

  const vWiped = await buildView(ctxId, "what should I look at first", {
    banner: `(wiped: ${removed.entries} findings + ${removed.artifacts} pinned belief — gone)`,
  });
  show(vWiped, "ACT THREE · you wiped her — and she woke back as herself");
  const leader = vWiped.focus.find((f) => f.lead);
  check("act3: findings were forgotten (episodic wiped)", afterEntries.length === 0 && beforeEntries.length > 0);
  check("act3: the pinned belief is gone (derived wiped)", vWiped.ridingWithMe.length === 0);
  check("act3: WHO I AM survived", vWiped.directives.length > 0);
  check("act3: still prioritizing — reliability still leads the focus", /reliability/i.test(leader?.title ?? ""));
  check("act3: where-she-left-off survived", vWiped.leftOff !== null);
  narrate("Nothing was running. We wiped her, and she woke back as herself, still holding today's priority.");
  narrate("Continuity lived in the data — rebuilt every time she wakes.");

  // ── verdict ───────────────────────────────────────────────────────────────
  const ok = checks.every((c) => c.ok);
  console.log("\n" + "─".repeat(60));
  for (const c of checks) console.log(`  ${c.ok ? "✅" : "❌"} ${c.name}`);
  console.log(
    `\n${ok ? "✅" : "❌"} the panel held the story: wake as someone · a declared priority ` +
      `re-ranked the whole pile (the lens, not the query) · a belief hardened through use and ` +
      `rode across a wake · clear() wiped what she learned yet she woke back as herself, still ` +
      `prioritizing — continuity reconstructed from data, no engine running.`
  );
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
