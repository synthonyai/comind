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

import { createComind, type AgentActionOutput } from "@/lib/comind";
import { InMemoryMemoryStore } from "@/demo/inMemoryStore";
import { StubEmbeddings, StubLLM, makeChecker } from "@/characterization/stubs";

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

const NULL_CRITIC: AgentActionOutput = {
  response: "STUB",
  memoryCritic: { artifacts: [], updatesToRecalledMemories: [] },
};

async function seedWorld(store: InMemoryMemoryStore, embeddings: StubEmbeddings) {
  const ctx = await store.createContext({
    name: "Characterization Context",
    seedIntent: "Ship CoMind v0.1 as an embeddable cognitive layer other developers can plug in.",
    values: ["clarity", "developer-trust"],
  });
  await store.createAgentProfile({
    homeContextId: ctx.id,
    description: "Characterization agent",
    directives: ["prioritize the storage abstraction", "keep the reference app working"],
    watchWords: ["deadline", "boundary"],
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

  report();
}

main().catch((e) => {
  console.error("[recall] error:", e);
  process.exitCode = 1;
});
