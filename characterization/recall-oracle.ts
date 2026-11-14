/**
 * Recall characterization (Bucket A/B/C — the intention-weighted rerank)
 * --------------------------------------------------------------------------
 * The crown-jewel behavior: recall is NOT raw nearest-neighbor. Memories are
 * retrieved by similarity, then RE-RANKED by alignment with the agent's standing
 * intention (seed intent, goals, directives, watch words), and derived artifacts
 * SUPERSEDE the raw entries they distilled (prefer-artifact dedup). This pins
 * those invariants through the only surface that still exposes recall in the
 * open-source library: `runAgent`'s decision trace (`trace.recalled`).
 *
 * NOTE — this is a REWRITE, not a port. The private `recall-oracle.ts` is a
 * golden-JSON snapshot over three functions the open-source carve removed
 * (`retrieveMemory`, `recallForContext`, `getIntentionTerms` — thin Prisma-coupled
 * wrappers over the surviving `searchWithIntention` engine). The engine is intact
 * and on the live runAgent path; we assert its observable invariants here instead
 * of freezing exact scores (which were HuggingFace-embedding-specific anyway).
 *
 * Deterministic: hashed stub embedder + a critic that produces nothing (so recall
 * is observed clean). Usage: npm run characterize:recall
 */

import { createComind } from "@/lib/comind";
import { InMemoryMemoryStore } from "@/demo/inMemoryStore";
import { StubEmbeddings, StubLLM, makeChecker, type StubTurn } from "@/characterization/stubs";

// A small, coherent world where intention reranking should visibly reorder
// results vs. raw similarity. Indices 0/5/1/3 align with the intent/goals/watch
// words; 2 and 4 are off-topic distractors that should sink.
const MEMORIES = [
  { content: "Decided the MemoryStore interface should own similarity search so any database can plug in.", tags: ["storage", "decision"], aligned: true },
  { content: "The reference journaling app must keep working throughout the extraction.", tags: ["app", "constraint"], aligned: true },
  { content: "Bought groceries and went for a run this morning.", tags: ["personal"], aligned: false },
  { content: "The deadline for the v0.1 boundary work is the end of the quarter.", tags: ["deadline"], aligned: true },
  { content: "Read a book about Roman history over the weekend.", tags: ["personal"], aligned: false },
  { content: "The CLI demo should use an in-memory store to prove extraction works without Prisma.", tags: ["demo", "storage"], aligned: true },
];
const QUERY = "What did we decide about the storage abstraction and the library boundary?";

const NULL_CRITIC: StubTurn = {
  response: "STUB",
  memoryCritic: { artifacts: [], usedMemoryIds: [], updatesToRecalledMemories: [] },
};

async function seedWorld(store: InMemoryMemoryStore, embeddings: StubEmbeddings) {
  const ctx = await store.createContext({
    name: "Characterization Context",
    seedIntent: "Ship CoMind v0.1 as an embeddable cognitive layer other developers can plug in.",
    values: ["clarity", "developer-trust"],
    watchWords: ["deadline", "boundary"],
  });
  await store.createAgentProfile({
    homeContextId: ctx.id,
    description: "Characterization agent",
    directives: ["prioritize the storage abstraction", "keep the reference app working"],
  });
  await store.createGoal({ contextId: ctx.id, title: "Extract the lib/comind library boundary", weight: 0.9 });
  await store.createGoal({ contextId: ctx.id, title: "Build the CLI demo with an in-memory store", weight: 0.6 });

  const entryIds: string[] = [];
  for (const m of MEMORIES) {
    const e = await store.createMemoryEntry({
      contextId: ctx.id,
      type: "NOTE",
      content: m.content,
      tags: m.tags,
      embedding: await embeddings.embed(m.content),
    });
    entryIds.push(e.id);
  }
  return { ctx, entryIds };
}

async function main() {
  const { check, checkTrue, report } = makeChecker("recall");

  // === Part A — intention rerank sinks the distractors ======================
  {
    const store = new InMemoryMemoryStore();
    const embeddings = new StubEmbeddings();
    const { ctx, entryIds } = await seedWorld(store, embeddings);
    const comind = createComind({ userId: "demo", store, embeddings, llm: new StubLLM(NULL_CRITIC) });

    const { trace } = await comind.runAgent(ctx.id, QUERY);
    const recalled = trace.recalled.entries;
    const indexOfEntry = (id: string) => entryIds.indexOf(id);

    // rank position (0 = top of recall) keyed by fixture index; -1 if not recalled
    const rankByFixtureIdx = new Map<number, number>();
    recalled.forEach((e, pos) => rankByFixtureIdx.set(indexOfEntry(e.id), pos));

    console.log("[recall] Part A — recalled order (fixture idx → rank):");
    recalled.forEach((e, pos) =>
      console.log(`    #${pos}  idx ${indexOfEntry(e.id)}  intention ${e.intention.toFixed(3)}  "${e.preview.slice(0, 48)}…"`),
    );

    const alignedRanks = [...rankByFixtureIdx.entries()].filter(([i]) => MEMORIES[i].aligned).map(([, r]) => r);
    const distractorRanks = [...rankByFixtureIdx.entries()].filter(([i]) => !MEMORIES[i].aligned).map(([, r]) => r);

    checkTrue("the storage-decision memory (idx 0) is recalled", rankByFixtureIdx.has(0));
    checkTrue("at least one aligned memory surfaced", alignedRanks.length > 0);
    // The invariant: every recalled distractor ranks below every recalled aligned
    // memory (raw similarity would interleave them; intention pushes them down).
    const worstAligned = alignedRanks.length ? Math.max(...alignedRanks) : -1;
    const bestDistractor = distractorRanks.length ? Math.min(...distractorRanks) : Infinity;
    checkTrue(
      "every aligned memory outranks every distractor",
      worstAligned < bestDistractor,
      { worstAlignedRank: worstAligned, bestDistractorRank: bestDistractor },
    );
  }

  // === Part B — a derived artifact supersedes its source entry ==============
  {
    const store = new InMemoryMemoryStore();
    const embeddings = new StubEmbeddings();
    const { ctx, entryIds } = await seedWorld(store, embeddings);

    // Distill memory[0] into a DECISION artifact, embedded + linked to its source.
    const artifactContent =
      "Decision: the storage layer is abstracted behind a MemoryStore interface so any database backend can plug in.";
    const artifact = await store.createArtifact({
      contextId: ctx.id,
      type: "DECISION",
      content: artifactContent,
      tags: ["storage", "decision", "boundary"],
      confidence: 0.85,
      embedding: await embeddings.embed(artifactContent),
      sourceEntryIds: [entryIds[0]],
    });

    const comind = createComind({ userId: "demo", store, embeddings, llm: new StubLLM(NULL_CRITIC) });
    const { trace } = await comind.runAgent(ctx.id, QUERY);

    console.log("[recall] Part B — recalled artifacts:", trace.recalled.artifacts.map((a) => `[${a.type}] ${a.preview.slice(0, 40)}…`));

    const artifactRecalled = trace.recalled.artifacts.some((a) => a.id === artifact.id);
    const sourceEntryRecalled = trace.recalled.entries.some((e) => e.id === entryIds[0]);
    checkTrue("the derived artifact surfaces in recall", artifactRecalled);
    checkTrue("its source entry is superseded (collapsed under the artifact)", !sourceEntryRecalled);
  }

  // === Part C — relevance floor: memories must be about the message ========
  // Goals/values only REORDER what passes the floor; they can't pull in a
  // memory that isn't about what was said (found in Touchstone 2026-11-14:
  // every memory came up for every message).
  {
    // No words in common with any memory (the stub embedder is bag-of-words, so
    // filler like "the"/"for" counts as overlap — keep the off-topic query clean).
    const OFF_TOPIC = "banana bread recipe";
    const FLOOR = 0.2;

    // No floor (today's default when the provider declares none): an off-topic
    // message still pulls in memories, lifted by the goals and values.
    {
      const store = new InMemoryMemoryStore();
      const embeddings = new StubEmbeddings();
      const { ctx } = await seedWorld(store, embeddings);
      const comind = createComind({ userId: "demo", store, embeddings, llm: new StubLLM(NULL_CRITIC) });
      const r = await comind.recall(ctx.id, OFF_TOPIC);
      checkTrue("without a floor, an off-topic message still recalls memories", r.entries.length > 0, { n: r.entries.length });
    }

    // Floor set by the app: off-topic recalls nothing; on-topic keeps what it's about.
    {
      const store = new InMemoryMemoryStore();
      const embeddings = new StubEmbeddings();
      const { ctx, entryIds } = await seedWorld(store, embeddings);
      const comind = createComind({ userId: "demo", store, embeddings, llm: new StubLLM(NULL_CRITIC), intention: { relevanceFloor: FLOOR } });
      const off = await comind.recall(ctx.id, OFF_TOPIC);
      check("with a floor, an off-topic message recalls nothing", off.entries.length + off.artifacts.length, 0);
      const on = await comind.recall(ctx.id, QUERY, { explain: true });
      console.log("[recall] Part C — on-topic with floor:", on.entries.map((e) => `${e.why!.signals.similarity.value.toFixed(2)} "${e.content.slice(0, 40)}…"`));
      checkTrue("the storage-decision memory still comes up", on.entries.some((e) => e.id === entryIds[0]));
      checkTrue("everything recalled is past the floor", on.entries.every((e) => e.why!.signals.similarity.value >= FLOOR));
    }

    // Floor declared by the embedding provider (it knows its model); the app can turn it off with 0.
    {
      class FlooredEmbeddings extends StubEmbeddings { readonly relevanceFloor = FLOOR; }
      const store = new InMemoryMemoryStore();
      const embeddings = new FlooredEmbeddings();
      const { ctx } = await seedWorld(store, embeddings);
      const declared = createComind({ userId: "demo", store, embeddings, llm: new StubLLM(NULL_CRITIC) });
      check("the provider's declared floor applies", (await declared.recall(ctx.id, OFF_TOPIC)).entries.length, 0);
      const off = createComind({ userId: "demo", store, embeddings, llm: new StubLLM(NULL_CRITIC), intention: { relevanceFloor: 0 } });
      checkTrue("the app can override it (0 = off)", (await off.recall(ctx.id, OFF_TOPIC)).entries.length > 0);
    }
  }

  // === Part D — filler words in goals don't count as matches ================
  {
    const store = new InMemoryMemoryStore();
    const embeddings = new StubEmbeddings();
    const ctx = await store.createContext({ name: "Filler", seedIntent: "" });
    await store.createGoal({ contextId: ctx.id, title: "Get one or two other people testing it before that deadline", weight: 0.9 });
    const text = "I just think that other people would like this.";
    await store.createMemoryEntry({ contextId: ctx.id, type: "NOTE", content: text, tags: [], embedding: await embeddings.embed(text) });
    const comind = createComind({ userId: "demo", store, embeddings, llm: new StubLLM(NULL_CRITIC) });
    const r = await comind.recall(ctx.id, text, { explain: true });
    const terms = r.entries[0]?.why?.matched.map((m) => m.term) ?? [];
    console.log("[recall] Part D — goal terms matched:", terms);
    check("filler words (other, that, …) don't match a goal", terms.filter((t) => ["other", "that", "just", "would", "like"].includes(t)).length, 0);
    checkTrue("real words still do", terms.includes("people"));
  }

  report();
}

main().catch((e) => {
  console.error("[recall] error:", e);
  process.exitCode = 1;
});
