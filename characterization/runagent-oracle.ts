/**
 * runAgent characterization (Bucket E — the assembled-prompt path)
 * --------------------------------------------------------------------------
 * The activation / artifact oracles pin write-back primitives directly; this one
 * exercises the FULL runAgent path and the two pure pieces Bucket E added on it:
 * the `{response, trace}` decision trace (inspectability #6 + provenance #10) and
 * the token budget + eviction step.
 *
 * Deterministic because the LLM is stubbed (fixed AgentActionOutput, no network)
 * and the embedder is the hashed stub — recall still runs for real against the
 * in-memory store, so the trace reflects what genuinely surfaced.
 *
 * Prisma-free port of the private `runagent-oracle.ts`. Scenario 1 drives the
 * public `createComind` factory; scenario 2 calls `runAgent` directly to pass the
 * `tokenBudget` (the factory closure doesn't forward it).
 *
 * Usage: npm run characterize:runagent
 */

import { createComind, type AgentActionOutput } from "@/lib/comind";
import { runAgent } from "@/lib/comind/agentRuntime/runAgent";
import { InMemoryMemoryStore } from "@/demo/inMemoryStore";
import { StubEmbeddings, StubLLM, makeChecker } from "@/characterization/stubs";

const ENTRIES = [
  "We chose Postgres over Mongo for relational integrity.",
  "pgvector keeps the embeddings in the same Postgres store.",
  "The datastore decision favors a single store for recall and persistence.",
];
const QUERY = "What did we decide about the database and storage architecture?";
const STUB_RESPONSE = "STUB: the single-store datastore decision is recorded.";
const STUB_ARTIFACT = "Decision: adopt Postgres + pgvector as the single store.";

async function seed(store: InMemoryMemoryStore, embeddings: StubEmbeddings) {
  const ctx = await store.createContext({
    name: "RunAgent Context",
    seedIntent: "Decide and record the datastore architecture for the project.",
  });
  await store.createAgentProfile({
    homeContextId: ctx.id,
    description: "Architecture guide",
    directives: ["record decisions with rationale"],
    watchWords: ["database", "storage"],
  });
  const goal = await store.createGoal({
    contextId: ctx.id,
    title: "Ship the single-store architecture",
    weight: 0.8,
  });
  const entryIds: string[] = [];
  for (const content of ENTRIES) {
    const e = await store.createMemoryEntry({
      contextId: ctx.id,
      type: "NOTE",
      content,
      embedding: await embeddings.embed(content),
    });
    entryIds.push(e.id);
  }
  return { ctx, goal, entryIds };
}

function stubFor(entryIds: string[], goalId: string): StubLLM {
  const out: AgentActionOutput = {
    response: STUB_RESPONSE,
    memoryCritic: {
      artifacts: [
        {
          type: "DECISION",
          content: STUB_ARTIFACT,
          title: "Datastore decision",
          confidence: 0.9,
          tags: ["datastore", "decision"],
          sourceEntryIds: entryIds,
          goalLinks: [{ goalId, strength: 0.8, rationale: "Realizes the single-store goal." }],
        },
      ],
      updatesToRecalledMemories: [],
    },
  };
  return new StubLLM(out);
}

async function main() {
  const { check, checkTrue, report } = makeChecker("runagent");

  // === Scenario 1 — default budget: full trace + write-back =================
  const store = new InMemoryMemoryStore();
  const embeddings = new StubEmbeddings();
  const { ctx, goal, entryIds } = await seed(store, embeddings);
  const comind = createComind({ userId: "demo", store, embeddings, llm: stubFor(entryIds, goal.id) });

  console.log("[runagent] scenario 1 — default budget…");
  const r1 = await comind.runAgent(ctx.id, QUERY);

  console.log("[runagent] response passthrough:");
  check("response is the stub's", r1.response, STUB_RESPONSE);

  console.log("[runagent] trace.recalled (what shaped the response):");
  check("recalled entry count", r1.trace.recalled.entries.length, 3);
  check("recalled artifact count (none seeded)", r1.trace.recalled.artifacts.length, 0);
  check(
    "recalled entry ids == seeded (sorted)",
    r1.trace.recalled.entries.map((e) => e.id).sort(),
    [...entryIds].sort(),
  );
  checkTrue(
    "every recalled entry has a string preview",
    r1.trace.recalled.entries.every((e) => typeof e.preview === "string" && e.preview.length > 0),
  );
  checkTrue(
    "every recalled entry has a numeric intention",
    r1.trace.recalled.entries.every((e) => typeof e.intention === "number"),
  );

  console.log("[runagent] trace.produced (what the critic derived):");
  check("produced artifact count", r1.trace.produced.artifacts.length, 1);
  const produced = r1.trace.produced.artifacts[0];
  check("produced type", produced?.type, "DECISION");
  check("produced provenance sourceEntryIds (sorted)", [...produced.sourceEntryIds].sort(), [...entryIds].sort());
  check("produced goal link goalId", produced?.goalLinks[0]?.goalId, goal.id);

  console.log("[runagent] trace.activated == recalled (the living loop ran):");
  check(
    "activated entry ids == recalled entry ids (sorted)",
    [...r1.trace.activated.entryIds].sort(),
    r1.trace.recalled.entries.map((e) => e.id).sort(),
  );

  console.log("[runagent] write-back actually persisted to the store:");
  const artifactHits = await store.searchSimilarArtifacts({
    contextId: ctx.id,
    vector: await embeddings.embedQuery(STUB_ARTIFACT),
    limit: 10,
  });
  const persisted = artifactHits.find((h) => h.artifact.content === STUB_ARTIFACT);
  checkTrue("produced artifact was persisted", persisted !== undefined);
  check("persisted artifact source links", persisted?.sourceEntryIds.length ?? 0, entryIds.length);
  checkTrue("persisted artifact embedding populated", (persisted?.artifact.embedding?.length ?? 0) > 0);
  const activated = await Promise.all(entryIds.map((id) => store.getMemoryEntry(id)));
  checkTrue("every recalled entry activationCount >= 1", activated.every((e) => (e?.activationCount ?? 0) >= 1));

  // === Scenario 2 — zero budget: eviction propagates through the path =======
  // Fresh world so activation state doesn't carry over. tokenBudget 0 must evict
  // ALL recall-driven blocks: nothing recalled, nothing activated — but the critic
  // still produces its artifact (production is not budget-gated).
  console.log("[runagent] scenario 2 — tokenBudget 0 (eviction)…");
  const store2 = new InMemoryMemoryStore();
  const emb2 = new StubEmbeddings();
  const s2 = await seed(store2, emb2);
  const r2 = await runAgent("demo", s2.ctx.id, QUERY, undefined, {
    store: store2,
    embeddings: emb2,
    llm: stubFor(s2.entryIds, s2.goal.id),
    tokenBudget: 0,
  });
  check("budget 0 → recalled entries evicted", r2.trace.recalled.entries.length, 0);
  check("budget 0 → recalled artifacts evicted", r2.trace.recalled.artifacts.length, 0);
  check("budget 0 → nothing activated (entries)", r2.trace.activated.entryIds.length, 0);
  check("budget 0 → nothing activated (artifacts)", r2.trace.activated.artifactIds.length, 0);
  check("budget 0 → critic still produced", r2.trace.produced.artifacts.length, 1);

  report();
}

main().catch((e) => {
  console.error("[runagent] error:", e);
  process.exitCode = 1;
});
