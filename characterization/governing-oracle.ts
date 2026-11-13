/**
 * Governing-memory oracle — pins how the things a mind steers by behave:
 *
 *   1. The root context is EXPLICIT (`isRoot`), never inferred; a second root is rejected.
 *   2. Values, watch words and directives are items (id, text, priority, outranks),
 *      stored with their owner, with add / update / remove verbs; contexts,
 *      agent profiles and goals have setters.
 *   3. Priority WITHIN a kind scales its recall weight; the order BETWEEN kinds
 *      is a setting (`intention.kindWeights`), with today's defaults.
 *   4. Outranking items sit above every other item in recall and are shown to
 *      the guide first, labelled "(comes first)".
 *   5. Recall alone isn't use: `reply` reinforces nothing; `extract` reinforces
 *      only the recalled memories the reply drew on (`usedMemoryIds`).
 *
 * Usage: npm run characterize:governing
 */

import { createComind, DEFAULT_KIND_WEIGHTS } from "@/lib/comind";
import { InMemoryMemoryStore } from "@/demo/inMemoryStore";
import { StubEmbeddings, StubLLM, makeChecker, type StubTurn } from "@/characterization/stubs";

const out = (): StubTurn => ({
  response: "STUB REPLY",
  memoryCritic: { artifacts: [], usedMemoryIds: [], updatesToRecalledMemories: [] },
});

/** Weight recall gave a matched term (via `why`), for the entry whose content contains it. */
async function termWeight(
  comind: ReturnType<typeof createComind>, contextId: string, query: string, term: string,
): Promise<number | undefined> {
  const r = await comind.recall(contextId, query, { explain: true });
  for (const e of r.entries) {
    const m = e.why?.matched.find((t) => t.term === term);
    if (m) return m.weight;
  }
  return undefined;
}

async function main() {
  const { check, checkTrue, report } = makeChecker("governing");

  // === 1: explicit root =====================================================
  {
    console.log("[governing] the root is explicit…");
    const store = new InMemoryMemoryStore();
    await store.createContext({ name: "Top-level but not root" });
    check("a top-level context is not the root by default", await store.getRootContextId(), null);
    const root = await store.createContext({ name: "Root", isRoot: true });
    check("the context marked isRoot is the root", await store.getRootContextId(), root.id);
    let rejected = false;
    try { await store.createContext({ name: "Second root", isRoot: true }); } catch { rejected = true; }
    checkTrue("a second root is rejected", rejected);
  }

  // === 2: items + setters ===================================================
  {
    console.log("[governing] items live with their owner and can be edited…");
    const store = new InMemoryMemoryStore();
    const embeddings = new StubEmbeddings();
    const comind = createComind({ userId: "demo", store, embeddings, llm: new StubLLM(out()) });

    const ctx = await comind.createContext({ name: "Garden", values: ["Patience", { text: "Native plants", priority: 0.9 }] });
    const profile = await comind.createAgentProfile({ homeContextId: ctx.id, name: "Gardener", directives: ["Be brief"] });

    check("seed strings become items at default priority", ctx.values.map((v) => [v.text, v.priority, v.outranks]),
      [["Patience", 0.5, false], ["Native plants", 0.9, false]]);
    checkTrue("every item has an id and kind", ctx.values.every((v) => !!v.id && v.kind === "value"));

    const ww = await comind.watchWords.add(ctx.id, { text: "pesticide", priority: 0.8 });
    const dir = await comind.directives.add(ctx.id, { text: "Ask about the weather" });
    let c = await store.getContext(ctx.id);
    let p = await store.getAgentProfileForContext(ctx.id);
    check("watch word stored on the context", c?.watchWords.map((w) => w.text), ["pesticide"]);
    check("directive stored on the agent profile", p?.directives.map((d) => d.text), ["Be brief", "Ask about the weather"]);
    check("kinds are kept", [ww.kind, dir.kind], ["watchWord", "directive"]);

    await comind.values.update(ctx.values[0].id, { text: "Patience with slow growth", priority: 0.2 });
    await comind.directives.remove(dir.id);
    await comind.updateContext(ctx.id, { seedIntent: "A garden that feeds us", description: "Backyard" });
    await comind.updateAgentProfile(profile.id, { name: "Garden Guide" });
    c = await store.getContext(ctx.id);
    p = await store.getAgentProfileForContext(ctx.id);
    check("value updated", [c?.values[0].text, c?.values[0].priority], ["Patience with slow growth", 0.2]);
    check("directive removed", p?.directives.map((d) => d.text), ["Be brief"]);
    check("context updated", [c?.seedIntent, c?.description, c?.name], ["A garden that feeds us", "Backyard", "Garden"]);
    check("agent profile updated", p?.name, "Garden Guide");

    const goal = await comind.createGoal({ contextId: ctx.id, title: "Harvest tomatoes" });
    const g2 = await comind.updateGoal(goal.id, { weight: 0.9, outranks: true });
    check("goal updated (priority + outranks)", [g2.weight, g2.outranks], [0.9, true]);
  }

  // === 3 + 4: priority, kind order, outranks in recall and the prompt =======
  {
    console.log("[governing] priority scales weight within a kind; kind order is a setting…");
    const store = new InMemoryMemoryStore();
    const embeddings = new StubEmbeddings();
    const llm = new StubLLM(out());
    const comind = createComind({ userId: "demo", store, embeddings, llm });

    const root = await comind.createContext({ name: "Root", isRoot: true, values: [{ text: "dolphins", outranks: true }] });
    const ctx = await comind.createContext({
      name: "Home", parentId: root.id,
      values: [{ text: "grass", priority: 0.2 }, { text: "garden", priority: 0.9 }],
    });
    await comind.createGoal({ contextId: ctx.id, title: "fence", weight: 1 });
    await comind.createAgentProfile({ homeContextId: ctx.id, directives: [{ text: "Be blunt", priority: 1 }, "Be kind"] });
    for (const t of ["mowed the grass today", "planted the garden beds", "fixed the fence post", "saved some dolphins"]) {
      await comind.storeMemory({ contextId: ctx.id, content: t });
    }

    const wGrass = await termWeight(comind, ctx.id, "grass", "grass");
    const wGarden = await termWeight(comind, ctx.id, "garden", "garden");
    const wFence = await termWeight(comind, ctx.id, "fence", "fence");
    const wDolphins = await termWeight(comind, ctx.id, "dolphins", "dolphins");
    check("low-priority value weight = value × 2 × 0.2", wGrass, DEFAULT_KIND_WEIGHTS.value * 2 * 0.2);
    check("high-priority value weight = value × 2 × 0.9", wGarden, DEFAULT_KIND_WEIGHTS.value * 2 * 0.9);
    check("goal at weight 1 = 1.5 (unchanged from before)", wFence, 1.5);
    checkTrue("by default a top goal outweighs a top value", (wFence ?? 0) > (wGarden ?? 0));
    checkTrue("an outranking item outweighs every other item", (wDolphins ?? 0) > Math.max(wFence ?? 0, wGarden ?? 0, 1.8));

    const why = (await comind.recall(ctx.id, "dolphins", { explain: true })).entries
      .flatMap((e) => e.why?.matched ?? []).find((m) => m.term === "dolphins");
    check("explain says the term came from an outranking root value",
      [why?.source.kind, why?.source.root, why?.source.outranks, !!why?.source.itemId], ["value", true, true, true]);

    // Order between kinds is a setting: values above goals.
    const reordered = createComind({
      userId: "demo", store, embeddings, llm,
      intention: { kindWeights: { value: 1.0, goal: 0.4 } },
    });
    const rGarden = await termWeight(reordered, ctx.id, "garden", "garden");
    const rFence = await termWeight(reordered, ctx.id, "fence", "fence");
    checkTrue("with kindWeights {value 1.0, goal 0.4}, the top value outweighs the top goal", (rGarden ?? 0) > (rFence ?? 0),
      { rGarden, rFence });
    checkTrue("outranking still sits above the re-ordered kinds",
      ((await termWeight(reordered, ctx.id, "dolphins", "dolphins")) ?? 0) > 2.0);

    console.log("[governing] the guide sees items in order, outranking ones labelled…");
    const turn = await comind.reply(ctx.id, "What should I do this weekend?");
    for await (const _ of turn.stream) { /* drain */ }
    const sys = turn.input.prompt.system;
    checkTrue("outranking root value labelled '(comes first)'", sys.includes("- dolphins (comes first)"));
    checkTrue("the outranks note is shown", sys.includes('Items marked "(comes first)" outrank everything else'));
    checkTrue("values listed highest priority first", sys.indexOf("garden (high priority)") < sys.indexOf("grass (low priority)"));
    checkTrue("directives listed highest priority first", sys.indexOf("Be blunt") < sys.indexOf("Be kind"));
    check("lens values carry priority", turn.input.lens.values.map((v) => [v.text, v.priority]), [["garden", 0.9], ["grass", 0.2]]);
    check("lens root values carry outranks", turn.input.lens.root?.values.map((v) => v.outranks), [true]);
  }

  // === 5: only what the reply used is reinforced ===========================
  {
    console.log("[governing] recall alone isn't use…");
    const store = new InMemoryMemoryStore();
    const embeddings = new StubEmbeddings();
    const stubOut = out();
    const comind = createComind({ userId: "demo", store, embeddings, llm: new StubLLM(stubOut) });
    const ctx = await comind.createContext({ name: "Running" });
    const used = await comind.storeMemory({ contextId: ctx.id, content: "Morning runs feel easier" });
    const junk = await comind.storeMemory({ contextId: ctx.id, content: "asdf runs" });

    const turn = await comind.reply(ctx.id, "How are my runs going?");
    let text = "";
    for await (const c of turn.stream) text += c;
    const recalledIds = turn.input.recalled.entries.map((e) => e.id);
    checkTrue("both entries were recalled", recalledIds.includes(used.id) && recalledIds.includes(junk.id), recalledIds);
    check("reply reinforced nothing", [(await store.getMemoryEntry(used.id))?.activationCount, (await store.getMemoryEntry(junk.id))?.activationCount], [0, 0]);

    stubOut.memoryCritic.usedMemoryIds = [used.id, "not-recalled-id"];
    const produced = await comind.extract(turn.input, text);
    check("extract reports what it reinforced", produced.activated, { entryIds: [used.id], artifactIds: [] });
    check("the used entry was reinforced", (await store.getMemoryEntry(used.id))?.activationCount, 1);
    check("the unused (junk) entry was not", (await store.getMemoryEntry(junk.id))?.activationCount, 0);
    checkTrue("extraction prompt asks which memories the reply drew on",
      (await (async () => { const l = new StubLLM(out()); const c2 = createComind({ userId: "demo", store, embeddings, llm: l });
        await c2.extract(turn.input, text); return l.calls[0]?.prompt ?? ""; })()).includes("usedMemoryIds"));
  }

  report();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
