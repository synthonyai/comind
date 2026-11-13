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
 *   6. The mind proposes, the person decides: `draftGoverning` drafts (stores
 *      nothing, knows the root so it doesn't repeat it); suggestions wait as
 *      pending and approving applies them; `updateContextSummary` writes the
 *      mind's own view.
 *
 * Usage: npm run characterize:governing
 */

import { createComind, DEFAULT_KIND_WEIGHTS, type LLMProvider, type LLMJob } from "@/lib/comind";
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

  // === 6: drafts, suggestions, the mind's view ===============================
  {
    console.log("[governing] the mind drafts and suggests; the person decides…");
    const calls: { job: LLMJob; prompt: string }[] = [];
    const llm: LLMProvider = {
      async *streamText() { yield ""; },
      async generateStructured<T>(p: { job: LLMJob; prompt: string }): Promise<T> {
        calls.push({ job: p.job, prompt: p.prompt });
        if (p.job === "drafting") {
          return {
            goals: [{ text: "Run 3x a week", priority: 0.8, why: "they said so" }],
            values: [{ text: "Consistency over intensity", priority: 0.5, why: "they said so" }],
            watchWords: [{ text: "skipped", priority: 0.5, why: "past pattern" }],
          } as T;
        }
        return { summary: "  Running is your reset; you push too hard early.  " } as T;
      },
    };
    const store = new InMemoryMemoryStore();
    const embeddings = new StubEmbeddings();
    const comind = createComind({ userId: "demo", store, embeddings, llm });
    await comind.createContext({ name: "Root", isRoot: true, values: ["Family first"] });
    const ctx = await comind.createContext({ name: "Fitness", seedIntent: "Run again" });

    const draft = await comind.draftGoverning({ about: { name: "Fitness", seedIntent: "Run again" }, text: "Guide: What does back look like?\nPerson: 3 runs a week." });
    check("draft job name", calls[0]?.job, "drafting");
    checkTrue("drafting prompt shows the root so it isn't repeated", calls[0]?.prompt.includes("Family first") ?? false);
    checkTrue("drafting prompt carries what the person said", calls[0]?.prompt.includes("3 runs a week") ?? false);
    check("draft returned", [draft.goals[0].text, draft.values[0].text, draft.watchWords[0].text], ["Run 3x a week", "Consistency over intensity", "skipped"]);
    check("drafting stored nothing", [(await store.listGoals({ contextId: ctx.id })).length, (await store.getContext(ctx.id))?.values.length], [0, 0]);

    const s1 = await comind.suggestions.add(ctx.id, { kind: "goal", text: "Run a 10k", priority: 0.5, rationale: "mentioned a race" });
    const s2 = await comind.suggestions.add(ctx.id, { kind: "value", text: "Listen to the body" });
    check("suggestions wait as pending", (await comind.suggestions.list(ctx.id)).map((x) => x.text), ["Run a 10k", "Listen to the body"]);
    await comind.suggestions.approve(s1.id, { text: "Run a 10k by spring", priority: 0.8 });
    await comind.suggestions.reject(s2.id);
    check("approving applies it in the person's words", (await store.listGoals({ contextId: ctx.id })).map((g) => [g.title, g.weight]), [["Run a 10k by spring", 0.8]]);
    check("rejecting applies nothing", (await store.getContext(ctx.id))?.values.length, 0);
    check("nothing left pending", (await comind.suggestions.list(ctx.id)).length, 0);
    let twice = false;
    try { await comind.suggestions.approve(s1.id); } catch { twice = true; }
    checkTrue("a decided suggestion can't be approved again", twice);

    await comind.storeMemory({ contextId: ctx.id, content: "Ran 5k, knee fine" });
    const updated = await comind.updateContextSummary(ctx.id, { seed: "I want consistency" });
    check("summary job name", calls.at(-1)?.job, "summary");
    checkTrue("summary prompt sees recent entries and the seed", (calls.at(-1)?.prompt.includes("Ran 5k") && calls.at(-1)?.prompt.includes("I want consistency")) ?? false);
    check("the mind's view is written to the context", updated.summary, "Running is your reset; you push too hard early.");
    await comind.updateContextSummary(ctx.id);
    checkTrue("a refresh sees its previous understanding", calls.at(-1)?.prompt.includes("Your previous understanding") ?? false);
  }

  report();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
