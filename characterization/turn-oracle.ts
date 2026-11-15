/**
 * Guide-turn characterization — the two-step turn and what travels with it.
 * --------------------------------------------------------------------------
 * Pins the behaviour added when the turn was split into `reply` + `extract`:
 *   1. Every model call names its job (`reply`, then `extraction`).
 *   2. `reply` streams; collected chunks are the full reply.
 *   3. The root context reaches the guide's prompt and `wake()` — and is absent
 *      when the turn's context IS the root.
 *   4. Focus entries stay out of recall/recent and become extraction's default
 *      sources.
 *   5. Typed links between entries (`storeMemory({ links })`, `link`, `listLinks`).
 *
 * Deterministic: in-memory store, hashed stub embedder, stub LLM (no network).
 *
 * Usage: npm run characterize:turn
 */

import { createComind } from "@/lib/comind";
import { InMemoryMemoryStore } from "@/demo/inMemoryStore";
import { StubEmbeddings, StubLLM, makeChecker, type StubTurn } from "@/characterization/stubs";

const REPLY = "STUB REPLY: let's look at the training plan together.";

function stub(artifactSources?: string[]): StubLLM {
  const out: StubTurn = {
    response: REPLY,
    memoryCritic: {
      artifacts: [{
        type: "INSIGHT",
        content: "Morning runs are easier to keep than evening runs.",
        confidence: 0.8,
        ...(artifactSources ? { sourceEntryIds: artifactSources } : {}),
      }],
      usedMemoryIds: [],
      updatesToRecalledMemories: [],
    },
  };
  return new StubLLM(out);
}

async function seed(store: InMemoryMemoryStore, embeddings: StubEmbeddings) {
  // The root context is marked explicitly.
  const root = await store.createContext({
    name: "Root",
    seedIntent: "Live a healthy, balanced life.",
    watchWords: ["burnout"],
    isRoot: true,
  });
  await store.createGoal({ contextId: root.id, title: "Sleep eight hours", weight: 0.9 });
  await store.createGoal({ contextId: root.id, title: "Honesty with myself", standing: true });
  await store.createAgentProfile({
    homeContextId: root.id,
    directives: ["Name a clash with the root context once, then move on"],
  });

  const ctx = await store.createContext({ name: "Fitness", seedIntent: "Run a half marathon.", parentId: root.id });
  await store.createGoal({ contextId: ctx.id, title: "Run three times a week", weight: 0.8 });
  await store.createAgentProfile({ homeContextId: ctx.id, name: "Coach", directives: ["Be concrete"] });

  const earlier = await store.createMemoryEntry({
    contextId: ctx.id, type: "NOTE",
    content: "Ran in the morning before work, felt great.",
    embedding: await embeddings.embed("Ran in the morning before work, felt great."),
  });
  return { root, ctx, earlier };
}

async function main() {
  const { check, checkTrue, report } = makeChecker("turn");

  // === 1–3: jobs, streaming, root context ===================================
  {
    const store = new InMemoryMemoryStore();
    const embeddings = new StubEmbeddings();
    const { root, ctx } = await seed(store, embeddings);
    const llm = stub();
    const comind = createComind({ userId: "demo", store, embeddings, llm });

    console.log("[turn] reply streams, names its job, carries the root context…");
    const turn = await comind.reply(ctx.id, "Should I run in the evening instead?");
    let text = "";
    let chunks = 0;
    for await (const c of turn.stream) { text += c; chunks++; }
    check("streamed reply == full reply", text, REPLY);
    checkTrue("reply arrived in more than one chunk", chunks > 1);
    check("first call's job", llm.calls[0]?.job, "reply");

    const system = turn.input.prompt.system;
    checkTrue("prompt has the root context section", system.includes("Root Context"));
    checkTrue("prompt has the root goal", system.includes("Sleep eight hours"));
    checkTrue("prompt has the root directive", system.includes("Name a clash with the root context once"));
    checkTrue("prompt has the root standing goal", system.includes("Honesty with myself"));
    checkTrue("prompt has this context's goal", system.includes("Run three times a week"));
    checkTrue("root section comes before this context",
      system.indexOf("Root Context") < system.indexOf("# This Context"));
    check("lens.root.contextId", turn.input.lens.root?.contextId, root.id);
    check("lens.root goal titles", turn.input.lens.root?.activeGoals.map((g) => g.title), ["Sleep eight hours", "Honesty with myself"]);
    check("last message sent is the new one", turn.input.prompt.messages.at(-1)?.content, "Should I run in the evening instead?");

    console.log("[turn] extract runs as its own job…");
    const produced = await comind.extract(turn.input, text);
    check("second call's job", llm.calls[1]?.job, "extraction");
    checkTrue("extraction prompt contains the guide's reply", llm.calls[1]?.prompt.includes(REPLY) ?? false);
    check("extraction produced one artifact", produced.artifacts.length, 1);

    console.log("[turn] wake carries the root; the root itself has none…");
    const awake = await comind.wake(ctx.id);
    check("wake governing.root.contextId", awake.governing.root?.contextId, root.id);
    check("wake root goals", awake.governing.root?.activeGoals.map((g) => g.title), ["Sleep eight hours", "Honesty with myself"]);
    const ruled = await comind.reply(ctx.id, "Quick one.", { instructions: ["HOUSE RULE: keep replies under 50 words"] });
    for await (const _ of ruled.stream) { /* drain */ }
    checkTrue("host instructions reach the prompt", ruled.input.prompt.system.includes("HOUSE RULE: keep replies under 50 words"));
    checkTrue("host instructions come before the root context",
      ruled.input.prompt.system.indexOf("HOUSE RULE") < ruled.input.prompt.system.indexOf("Root Context"));
    const rootTurn = await comind.reply(root.id, "How am I doing overall?");
    for await (const _ of rootTurn.stream) { /* drain */ }
    check("turn in the root context: lens.root is null", rootTurn.input.lens.root, null);
    check("wake of the root: governing.root is null", (await comind.wake(root.id)).governing.root, null);
  }

  // === 4: focus entries ======================================================
  {
    const store = new InMemoryMemoryStore();
    const embeddings = new StubEmbeddings();
    const { ctx, earlier } = await seed(store, embeddings);
    const comind = createComind({ userId: "demo", store, embeddings, llm: stub() });

    const note = await comind.storeMemory({ contextId: ctx.id, content: "Thinking of running in the evening instead of the morning." });
    console.log("[turn] focus entries stay out of recall and become default sources…");
    const r = await comind.runAgent(ctx.id, "Thinking of running in the evening instead of the morning.", { focusEntryIds: [note.id] });
    checkTrue("focus entry not in recalled", !r.input.recalled.entries.some((e) => e.id === note.id));
    checkTrue("focus entry not in recent", !r.input.recent.some((e) => e.id === note.id));
    check("input.focus carries the entry", r.input.focus.map((e) => e.id), [note.id]);
    checkTrue("other entries still recalled", r.input.recalled.entries.some((e) => e.id === earlier.id));
    check("uncited artifact falls back to the focus entry", r.trace.produced.artifacts[0]?.sourceEntryIds, [note.id]);

    const cited = createComind({ userId: "demo", store, embeddings, llm: stub([earlier.id, "not-a-real-id"]) });
    const r2 = await cited.runAgent(ctx.id, "Mornings again?", { focusEntryIds: [note.id] });
    check("cited sources kept, unknown ids dropped", r2.trace.produced.artifacts[0]?.sourceEntryIds, [earlier.id]);
  }

  // === 5: typed links =======================================================
  {
    const store = new InMemoryMemoryStore();
    const embeddings = new StubEmbeddings();
    const { ctx, earlier } = await seed(store, embeddings);
    const comind = createComind({ userId: "demo", store, embeddings, llm: stub() });

    console.log("[turn] typed links between entries…");
    const followUp = await comind.storeMemory({
      contextId: ctx.id,
      content: "Update: kept the morning runs all week.",
      links: [{ toId: earlier.id, type: "follows" }],
    });
    const out = await comind.listLinks({ entryId: followUp.id, direction: "from" });
    check("link from the new entry", out.map((l) => [l.toId, l.type]), [[earlier.id, "follows"]]);
    check("host-declared link is USER_EXPLICIT", out[0]?.attributionType, "USER_EXPLICIT");
    const into = await comind.listLinks({ entryId: earlier.id, direction: "to", type: "follows" });
    check("link arrives at the earlier entry", into.map((l) => l.fromId), [followUp.id]);
    await comind.link({ fromId: followUp.id, toId: earlier.id, type: "follows" });
    check("same link twice is not duplicated", (await comind.listLinks({ entryId: earlier.id })).length, 1);
    await comind.link({ fromId: followUp.id, toId: earlier.id, type: "related", attributionType: "AGENT_INFERRED" });
    check("a different type is a separate link", (await comind.listLinks({ entryId: earlier.id })).length, 2);
    check("type filter", (await comind.listLinks({ entryId: earlier.id, type: "related" })).length, 1);
  }

  report();
}

main().catch((e) => {
  console.error("[turn] error:", e);
  process.exitCode = 1;
});
