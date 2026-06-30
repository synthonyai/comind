/**
 * Boundary proof (PRD success criteria #1 + #2 + #6).
 * --------------------------------------------------------------------------
 * Runs the REAL runAgent end-to-end against a non-Prisma `InMemoryMemoryStore`,
 * with a deterministic stub embedder + stub LLM — so it needs NO database and NO
 * API keys. If this completes, then:
 *   #1 — a developer can embed CoMind by implementing the three interfaces.
 *   #2 — no Prisma/OpenAI/Next is loaded (asserted via the module cache).
 *   #6 — recall + write-back are inspectable via the decision trace (printed).
 *
 * This is the proving ground the PRD calls for — the thing that finally exercises
 * the boundary instead of asserting it. Run with NO DATABASE_URL to be sure:
 *   npm run demo:prove
 */

import { createComind, type EmbeddingProvider, type LLMProvider, type AgentActionOutput } from "@/lib/comind";
import { InMemoryMemoryStore } from "@/demo/inMemoryStore";

// --- A deterministic, key-free embedder: hashed bag-of-words, unit-normalized.
//     Shared words -> closer vectors, so recall is meaningful (if synthetic).
class StubEmbeddings implements EmbeddingProvider {
  readonly dimensions = 64;
  private vec(text: string): number[] {
    const v = new Array(this.dimensions).fill(0);
    for (const tok of text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
      let h = 0;
      for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) >>> 0;
      v[h % this.dimensions] += 1;
    }
    const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / n);
  }
  async embed(text: string) { return this.vec(text); }
  async embedQuery(text: string) { return this.vec(text); }
}

class StubLLM implements LLMProvider {
  constructor(private readonly out: AgentActionOutput) {}
  async generateStructured<T>(): Promise<T> { return this.out as unknown as T; }
}

const failures: string[] = [];
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) console.log(`  ✅ ${label}`);
  else { failures.push(label); console.log(`  ❌ ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); }
};

function prismaLoaded(): string[] {
  const cache = (require as unknown as { cache: Record<string, unknown> }).cache ?? {};
  return Object.keys(cache).filter((m) => ["@prisma/client", "/lib/comind/prisma", "/.prisma/", "openai"].some((f) => m.includes(f)));
}

async function main() {
  const store = new InMemoryMemoryStore();
  const embeddings = new StubEmbeddings();

  // --- Seed a small world through the store (the host's setup). ---
  const ctx = await store.createContext({
    name: "Datastore decisions",
    seedIntent: "Decide and record the datastore architecture.",
    values: ["relational integrity"],
  });
  await store.createAgentProfile({
    homeContextId: ctx.id,
    description: "Architecture guide",
    directives: ["record decisions with rationale"],
    watchWords: ["database", "storage"],
  });
  const goal = await store.createGoal({ contextId: ctx.id, title: "Ship the single-store architecture", weight: 0.8 });

  const entryContents = [
    "We chose Postgres over Mongo for relational integrity.",
    "pgvector keeps the embeddings in the same Postgres store.",
    "The datastore decision favors a single store for recall and persistence.",
  ];
  const entryIds: string[] = [];
  for (const content of entryContents) {
    const e = await store.createMemoryEntry({
      contextId: ctx.id, type: "NOTE", content, embedding: await embeddings.embed(content),
    });
    entryIds.push(e.id);
  }

  // The critic's (stubbed) conclusion references the real seeded ids.
  const stub = new StubLLM({
    response: "We're standardizing on Postgres + pgvector as the single store.",
    memoryCritic: {
      artifacts: [{
        type: "DECISION",
        content: "Adopt Postgres + pgvector as the single datastore for recall and persistence.",
        title: "Datastore decision",
        confidence: 0.9,
        tags: ["datastore", "decision"],
        sourceEntryIds: entryIds,
        goalLinks: [{ goalId: goal.id, strength: 0.8, rationale: "Realizes the single-store goal." }],
      }],
      updatesToRecalledMemories: [],
    },
  });

  // --- The public contract: createComind with all three providers injected. ---
  const comind = createComind({ userId: "demo", store, embeddings, llm: stub });

  console.log("\n[prove] running runAgent against the in-memory store…\n");
  const { response, trace } = await comind.runAgent(ctx.id, "What did we decide about the database and storage?");

  console.log("RESPONSE:", response);
  console.log("\nDECISION TRACE");
  console.log("  recalled entries :", trace.recalled.entries.map((e) => `${e.preview.slice(0, 40)}… (intent ${e.intention.toFixed(2)})`));
  console.log("  produced artifacts:", trace.produced.artifacts.map((a) => `[${a.type}] ${a.preview.slice(0, 50)}… ⇐ ${a.sourceEntryIds.length} sources, ${a.goalLinks.length} goal link(s)`));
  console.log("  activated         :", `${trace.activated.entryIds.length} entries, ${trace.activated.artifactIds.length} artifacts`);

  console.log("\n[prove] assertions:");
  check("runAgent returned a response", typeof response === "string" && response.length > 0);
  check("recall surfaced the seeded entries", trace.recalled.entries.length === entryIds.length, trace.recalled.entries.length);
  check("critic produced the DECISION artifact", trace.produced.artifacts[0]?.type === "DECISION");
  check("artifact carries provenance (source entries)", trace.produced.artifacts[0]?.sourceEntryIds.length === entryIds.length);
  check("artifact carries the goal link", trace.produced.artifacts[0]?.goalLinks[0]?.goalId === goal.id);
  check("the living loop activated the recalled entries", trace.activated.entryIds.length === entryIds.length);

  // The artifact is now semantically recallable — run a second turn and see the
  // store hold the derived conclusion (living loop + persistence across turns).
  const r2 = await comind.runAgent(ctx.id, "remind me of the storage decision");
  check("second turn recalls the derived artifact by relevance", r2.trace.recalled.artifacts.length >= 1, r2.trace.recalled.artifacts.length);

  const leaks = prismaLoaded();
  check("NO Prisma / OpenAI loaded (criterion #2)", leaks.length === 0, leaks);

  if (failures.length === 0) {
    console.log("\n[prove] ✅ PASS — runAgent runs end-to-end on a non-Prisma store. The boundary holds.");
  } else {
    console.log("\n[prove] ❌ FAIL:");
    failures.forEach((f) => console.log("  " + f));
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error("[prove] error:", e); process.exitCode = 1; });
