/**
 * Governing-memory oracle — pins how the things a mind steers by behave:
 *
 *   1. The root context is EXPLICIT (`isRoot`), never inferred; a second root is rejected.
 *   2. Watch words and directives are items (id, text, priority, outranks),
 *      stored with their owner, with add / update / remove verbs; contexts,
 *      agent profiles and goals have setters. Goals are completable or
 *      standing (an ongoing value), and carry signs and what they support.
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
 *   7. Governing memory flows down: a context sees its ancestors' goals and
 *      watch words (×`inheritedWeight`, default 1.25), but not their
 *      directives; signs count at their goal's weight; `supports` is shown.
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

    const ctx = await comind.createContext({ name: "Garden", watchWords: ["weeds", { text: "drought", priority: 0.9 }] });
    const profile = await comind.createAgentProfile({ homeContextId: ctx.id, name: "Gardener", directives: ["Be brief"] });

    check("seed strings become items at default priority", ctx.watchWords.map((v) => [v.text, v.priority, v.outranks]),
      [["weeds", 0.5, false], ["drought", 0.9, false]]);
    checkTrue("every item has an id and kind", ctx.watchWords.every((v) => !!v.id && v.kind === "watchWord"));

    const ww = await comind.watchWords.add(ctx.id, { text: "pesticide", priority: 0.8 });
    const dir = await comind.directives.add(ctx.id, { text: "Ask about the weather" });
    let c = await store.getContext(ctx.id);
    let p = await store.getAgentProfileForContext(ctx.id);
    check("watch word stored on the context", c?.watchWords.map((w) => w.text), ["weeds", "drought", "pesticide"]);
    check("directive stored on the agent profile", p?.directives.map((d) => d.text), ["Be brief", "Ask about the weather"]);
    check("kinds are kept", [ww.kind, dir.kind], ["watchWord", "directive"]);

    await comind.watchWords.update(ctx.watchWords[0].id, { text: "weeds everywhere", priority: 0.2 });
    await comind.directives.remove(dir.id);
    await comind.updateContext(ctx.id, { seedIntent: "A garden that feeds us", description: "Backyard" });
    await comind.updateAgentProfile(profile.id, { name: "Garden Guide" });
    c = await store.getContext(ctx.id);
    p = await store.getAgentProfileForContext(ctx.id);
    check("watch word updated", [c?.watchWords[0].text, c?.watchWords[0].priority], ["weeds everywhere", 0.2]);
    check("directive removed", p?.directives.map((d) => d.text), ["Be brief"]);
    check("context updated", [c?.seedIntent, c?.description, c?.name], ["A garden that feeds us", "Backyard", "Garden"]);
    check("agent profile updated", p?.name, "Garden Guide");

    const goal = await comind.createGoal({ contextId: ctx.id, title: "Harvest tomatoes" });
    check("a goal is completable by default, supports nothing, has no signs",
      [goal.standing, goal.supports, goal.signs], [false, [], { positive: [], negative: [] }]);
    const g2 = await comind.updateGoal(goal.id, { weight: 0.9, outranks: true });
    check("goal updated (priority + outranks)", [g2.weight, g2.outranks], [0.9, true]);
    const value = await comind.createGoal({
      contextId: ctx.id, title: "Patience", standing: true, supports: [goal.id],
      signs: { positive: ["waiting a season"] },
    });
    check("a standing goal (a value) with signs and supports",
      [value.standing, value.supports, value.signs], [true, [goal.id], { positive: ["waiting a season"], negative: [] }]);
    const v2 = await comind.updateGoal(value.id, { signs: { negative: ["pulling seedlings"] }, supports: [] });
    check("signs patch per list; supports replaced",
      [v2.signs, v2.supports], [{ positive: ["waiting a season"], negative: ["pulling seedlings"] }, []]);
    check("listGoals lists them", (await comind.listGoals(ctx.id)).map((g) => g.title).sort(), ["Harvest tomatoes", "Patience"]);
  }

  // === 3 + 4: priority, kind order, outranks in recall and the prompt =======
  {
    console.log("[governing] priority scales weight within a kind; kind order is a setting…");
    const store = new InMemoryMemoryStore();
    const embeddings = new StubEmbeddings();
    const llm = new StubLLM(out());
    const comind = createComind({ userId: "demo", store, embeddings, llm });

    const root = await comind.createContext({ name: "Root", isRoot: true });
    await comind.createGoal({ contextId: root.id, title: "dolphins", standing: true, outranks: true });
    const ctx = await comind.createContext({ name: "Home", parentId: root.id, watchWords: [{ text: "hose", priority: 0.9 }] });
    await comind.createGoal({ contextId: ctx.id, title: "grass", weight: 0.2, standing: true });
    await comind.createGoal({ contextId: ctx.id, title: "garden", weight: 0.9, standing: true });
    await comind.createGoal({ contextId: ctx.id, title: "fence", weight: 1 });
    await comind.createAgentProfile({ homeContextId: ctx.id, directives: [{ text: "Be blunt", priority: 1 }, "Be kind"] });
    for (const t of ["mowed the grass today", "planted the garden beds", "fixed the fence post", "saved some dolphins", "the hose leaks"]) {
      await comind.storeMemory({ contextId: ctx.id, content: t });
    }

    const wGrass = await termWeight(comind, ctx.id, "grass", "grass");
    const wGarden = await termWeight(comind, ctx.id, "garden", "garden");
    const wFence = await termWeight(comind, ctx.id, "fence", "fence");
    const wDolphins = await termWeight(comind, ctx.id, "dolphins", "dolphins");
    const wHose = await termWeight(comind, ctx.id, "hose", "hose");
    check("low-priority standing goal weight = goal × 2 × 0.2", wGrass, DEFAULT_KIND_WEIGHTS.goal * 2 * 0.2);
    check("high-priority standing goal weight = goal × 2 × 0.9", wGarden, DEFAULT_KIND_WEIGHTS.goal * 2 * 0.9);
    check("goal at weight 1 = 1.5 (unchanged from before)", wFence, 1.5);
    check("watch word weight = watchWord × 2 × 0.9", wHose, DEFAULT_KIND_WEIGHTS.watchWord * 2 * 0.9);
    checkTrue("by default a top goal outweighs a top watch word", (wFence ?? 0) > (wHose ?? 0));
    checkTrue("an outranking item outweighs every other item (incl. a boosted inherited one)",
      (wDolphins ?? 0) > Math.max(wFence ?? 0, wGarden ?? 0, 1.8, 2 * DEFAULT_KIND_WEIGHTS.goal * 1.25));

    const why = (await comind.recall(ctx.id, "dolphins", { explain: true })).entries
      .flatMap((e) => e.why?.matched ?? []).find((m) => m.term === "dolphins");
    check("explain says the term came from an outranking root goal",
      [why?.source.kind, why?.source.root, why?.source.inherited, why?.source.outranks, !!why?.source.itemId],
      ["goal", true, false, true, true]);

    // Order between kinds is a setting: watch words above goals.
    const reordered = createComind({
      userId: "demo", store, embeddings, llm,
      intention: { kindWeights: { watchWord: 1.0, goal: 0.4 } },
    });
    const rHose = await termWeight(reordered, ctx.id, "hose", "hose");
    const rFence = await termWeight(reordered, ctx.id, "fence", "fence");
    checkTrue("with kindWeights {watchWord 1.0, goal 0.4}, the top watch word outweighs the top goal", (rHose ?? 0) > (rFence ?? 0),
      { rHose, rFence });
    checkTrue("outranking still sits above the re-ordered kinds",
      ((await termWeight(reordered, ctx.id, "dolphins", "dolphins")) ?? 0) > 2.0);

    console.log("[governing] the guide sees items in order, outranking ones labelled…");
    const turn = await comind.reply(ctx.id, "What should I do this weekend?");
    for await (const _ of turn.stream) { /* drain */ }
    const sys = turn.input.prompt.system;
    checkTrue("outranking root goal labelled '(comes first)' and '(ongoing)'", sys.includes("- dolphins (comes first) (ongoing)"));
    checkTrue("the outranks note is shown", sys.includes('Items marked "(comes first)" outrank everything else'));
    checkTrue("the ongoing note is shown", sys.includes('"(ongoing)" marks a standing value'));
    checkTrue("goals & values listed highest priority first",
      sys.indexOf("fence") < sys.indexOf("garden (high priority) (ongoing)") && sys.indexOf("garden (high") < sys.indexOf("grass (low priority) (ongoing)"));
    checkTrue("directives listed highest priority first", sys.indexOf("Be blunt") < sys.indexOf("Be kind"));
    check("lens goals carry priority and standing",
      turn.input.lens.activeGoals.map((g) => [g.title, g.weight, g.standing]), [["fence", 1, false], ["garden", 0.9, true], ["grass", 0.2, true]]);
    check("lens root goals carry outranks", turn.input.lens.root?.activeGoals.map((g) => g.outranks), [true]);
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
    let familyId = "";
    const llm: LLMProvider = {
      async *streamText() { yield ""; },
      async generateStructured<T>(p: { job: LLMJob; prompt: string }): Promise<T> {
        calls.push({ job: p.job, prompt: p.prompt });
        if (p.job === "drafting") {
          return {
            intent: "Feel strong again",
            goals: [
              { text: "Run 3x a week", priority: 0.8, why: "they said so", standing: false, supports: [familyId, "made-up-id"], signs: { positive: [], negative: [] } },
              { text: "Consistency over intensity", priority: 0.5, why: "they said so", standing: true, supports: [], signs: { positive: ["short easy runs"], negative: ["all-or-nothing week"] } },
            ],
            watchWords: [{ text: "skipped", priority: 0.5, why: "past pattern" }],
            children: [{ name: "Running", intent: "Run again", why: "they said so" }],
          } as T;
        }
        return { summary: "  Running is your reset; you push too hard early.  " } as T;
      },
    };
    const store = new InMemoryMemoryStore();
    const embeddings = new StubEmbeddings();
    const comind = createComind({ userId: "demo", store, embeddings, llm });
    const root = await comind.createContext({ name: "Root", isRoot: true });
    const family = await comind.createGoal({ contextId: root.id, title: "Family first", standing: true });
    familyId = family.id;
    const ctx = await comind.createContext({ name: "Fitness", seedIntent: "Run again", parentId: root.id });

    const draft = await comind.draftGoverning({ about: { name: "Fitness", seedIntent: "Run again" }, text: "Guide: What does back look like?\nPerson: 3 runs a week." });
    check("draft job name", calls[0]?.job, "drafting");
    checkTrue("drafting prompt shows the root so it isn't repeated", calls[0]?.prompt.includes("Family first (ongoing)") ?? false);
    checkTrue("drafting prompt lists broader goals by id", calls[0]?.prompt.includes(`[ID:${family.id}] Family first`) ?? false);
    checkTrue("drafting prompt carries what the person said", calls[0]?.prompt.includes("3 runs a week") ?? false);
    checkTrue("drafting prompt doesn't ask for intent/children unless asked",
      !(calls[0]?.prompt.includes("INTENT —") || calls[0]?.prompt.includes("CHILDREN —")));
    check("draft returned", [draft.goals[0].text, draft.goals[1].text, draft.goals[1].standing, draft.watchWords[0].text],
      ["Run 3x a week", "Consistency over intensity", true, "skipped"]);
    check("unknown supports ids are dropped", draft.goals[0].supports, [family.id]);
    check("signs come through", draft.goals[1].signs, { positive: ["short easy runs"], negative: ["all-or-nothing week"] });
    check("intent / children not returned unless asked", [draft.intent, draft.children], [null, []]);
    const asked = await comind.draftGoverning({ about: { name: "Root" }, text: "…", contextId: root.id, include: { intent: true, children: true } });
    checkTrue("asked: the prompt requests intent and children", (calls.at(-1)?.prompt.includes("INTENT —") && calls.at(-1)?.prompt.includes("CHILDREN —")) ?? false);
    check("asked: intent and children returned", [asked.intent, asked.children.map((c) => c.name)], ["Feel strong again", ["Running"]]);
    check("drafting stored nothing", (await store.listGoals({ contextId: ctx.id })).length, 0);

    const s1 = await comind.suggestions.add(ctx.id, { kind: "goal", text: "Run a 10k", priority: 0.5, rationale: "mentioned a race" });
    const s2 = await comind.suggestions.add(ctx.id, { kind: "goal", text: "Listen to the body", standing: true });
    const s3 = await comind.suggestions.add(ctx.id, { kind: "goal", text: "Stretch daily", standing: true, supports: [family.id] });
    check("suggestions wait as pending", (await comind.suggestions.list(ctx.id)).map((x) => x.text), ["Run a 10k", "Listen to the body", "Stretch daily"]);
    await comind.suggestions.approve(s1.id, { text: "Run a 10k by spring", priority: 0.8 });
    await comind.suggestions.reject(s2.id);
    await comind.suggestions.approve(s3.id);
    check("approving applies it in the person's words, standing and supports kept",
      (await store.listGoals({ contextId: ctx.id })).map((g) => [g.title, g.weight, g.standing, g.supports]),
      [["Run a 10k by spring", 0.8, false, []], ["Stretch daily", 0.5, true, [family.id]]]);
    check("rejecting applies nothing", (await store.listGoals({ contextId: ctx.id })).some((g) => g.title === "Listen to the body"), false);
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

  // === 7: flow-down, signs, supports =======================================
  {
    console.log("[governing] governing memory flows down; signs count; supports are shown…");
    const store = new InMemoryMemoryStore();
    const embeddings = new StubEmbeddings();
    const llm = new StubLLM(out());
    const comind = createComind({ userId: "demo", store, embeddings, llm });

    const root = await comind.createContext({ name: "North", isRoot: true });
    const area = await comind.createContext({ name: "Health", seedIntent: "Being healthy", parentId: root.id, watchWords: ["exhausted"] });
    await comind.createAgentProfile({ homeContextId: area.id, directives: ["Only the Health guide says this"] });
    const sleep = await comind.createGoal({
      contextId: area.id, title: "sleep", standing: true,
      signs: { positive: ["lights out early"], negative: ["scrolling late"] },
    });
    const child = await comind.createContext({ name: "Fitness", parentId: area.id });
    await comind.createAgentProfile({ homeContextId: child.id, directives: ["Fitness rule"] });
    await comind.createGoal({ contextId: child.id, title: "stretch", supports: [sleep.id] });
    for (const t of ["slept badly, scrolling late again", "did a stretch", "sleep was fine", "felt exhausted"]) {
      await comind.storeMemory({ contextId: child.id, content: t });
    }

    const inherited = DEFAULT_KIND_WEIGHTS.goal * 2 * 0.5 * 1.25;
    check("an ancestor's goal weighs ×1.25 in the child", await termWeight(comind, child.id, "sleep", "sleep"), inherited);
    check("the child's own goal weighs the normal amount", await termWeight(comind, child.id, "stretch", "stretch"), DEFAULT_KIND_WEIGHTS.goal * 2 * 0.5);
    check("an ancestor's watch word flows down too", await termWeight(comind, child.id, "exhausted", "exhausted"), DEFAULT_KIND_WEIGHTS.watchWord * 2 * 0.5 * 1.25);
    check("a sign counts at its goal's weight", await termWeight(comind, child.id, "scrolling", "scrolling"), inherited);
    const signWhy = (await comind.recall(child.id, "scrolling", { explain: true })).entries
      .flatMap((e) => e.why?.matched ?? []).find((m) => m.term === "scrolling");
    check("explain names the sign's goal, inherited", [signWhy?.source.kind, signWhy?.source.itemId, signWhy?.source.inherited, signWhy?.source.root],
      ["sign", sleep.id, true, false]);
    const flat = createComind({ userId: "demo", store, embeddings, llm, intention: { inheritedWeight: 1 } });
    check("inheritedWeight is a setting", await termWeight(flat, child.id, "sleep", "sleep"), DEFAULT_KIND_WEIGHTS.goal * 2 * 0.5);
    check("the area's own goals weigh normally in the area", await termWeight(comind, area.id, "sleep", "sleep"), DEFAULT_KIND_WEIGHTS.goal * 2 * 0.5);

    const woke = await comind.wake(child.id);
    check("wake carries the inherited frames", woke.governing.inherited.map((f) => [f.context?.name, f.activeGoals.map((g) => g.title)]), [["Health", ["sleep"]]]);
    check("the root isn't counted as inherited", (await comind.wake(area.id)).governing.inherited.length, 0);

    const turn = await comind.reply(child.id, "How am I doing?");
    for await (const _ of turn.stream) { /* drain */ }
    const sys = turn.input.prompt.system;
    checkTrue("the guide sees the wider context", sys.includes("# From Health"));
    checkTrue("…its goals, ongoing, with signs", sys.includes("- sleep (ongoing)") && sys.includes("when it's drifting: scrolling late") && sys.includes("when it's lived: lights out early"));
    checkTrue("…but not its guide's directives", !sys.includes("Only the Health guide says this") && sys.includes("Fitness rule"));
    checkTrue("a goal says what it serves", sys.includes("- stretch — serves: sleep"));
    check("the lens carries inherited frames", turn.input.lens.inherited.map((f) => [f.name, f.activeGoals.map((g) => g.title)]), [["Health", ["sleep"]]]);
    await comind.updateContext(child.id, { parentId: root.id });
    check("moving a context changes what it inherits", (await comind.wake(child.id)).governing.inherited.length, 0);
    await comind.updateContext(child.id, { parentId: area.id });
    let refused = false;
    try { await comind.updateContext(area.id, { parentId: child.id }); } catch { refused = true; }
    checkTrue("a context can't be moved under its own child", refused && (await store.getContext(area.id))?.parentId === root.id);
    checkTrue("extraction sees inherited goals too", (await (async () => { const l = new StubLLM(out()); const c2 = createComind({ userId: "demo", store, embeddings, llm: l });
      await c2.extract(turn.input, "ok"); return l.calls[0]?.prompt ?? ""; })()).includes(`[ID:${sleep.id}] sleep (weight 0.5, ongoing)`));
  }

  report();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
