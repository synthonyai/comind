// demo/smokeRecall.ts
//
// Functional smoke for the v0.2 item-A public surface: the standalone
// `recall()` (intention-ranked, no agent turn) and `listMemories()` (plain,
// unranked). Seeds a small world through the in-memory store, then exercises
// both verbs directly off the createComind instance. Run: npm run smoke:recall
import { createComind } from "@/lib/comind";
import { InMemoryMemoryStore } from "@/demo/inMemoryStore";
import { StubEmbeddings, ScriptedLLM } from "@/demo/stubProviders";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const store = new InMemoryMemoryStore();
  const embeddings = new StubEmbeddings();
  const llm = new ScriptedLLM();

  const ctx = await store.createContext({
    name: "Datastore decisions",
    seedIntent: "Decide and record the datastore architecture.",
    values: ["relational integrity"],
  });

  const contents = [
    "We chose Postgres over Mongo for relational integrity.",
    "pgvector keeps the embeddings in the same Postgres store.",
    "Standup notes: coffee machine is broken again.",
  ];
  for (const content of contents) {
    await store.createMemoryEntry({
      contextId: ctx.id, type: "NOTE", content, embedding: await embeddings.embed(content),
    });
  }

  const comind = createComind({ userId: "demo", store, embeddings, llm });

  console.log("\n[smoke] recall('...postgres storage...'):");
  const recalled = await comind.recall(ctx.id, "What did we decide about postgres storage?");
  console.log("  entries:", recalled.entries.map((e) => `${e.content.slice(0, 40)}… (intent ${e.intention.toFixed(2)})`));
  check("recall returned entries", recalled.entries.length > 0, recalled.entries.length);
  check("recall entries carry an intention score", recalled.entries.every((e) => typeof e.intention === "number"));
  check("recall ranks a storage note above the coffee note",
    (recalled.entries[0]?.content ?? "").toLowerCase().includes("postgres"),
    recalled.entries[0]?.content);
  check("recall returns an artifacts array", Array.isArray(recalled.artifacts));

  console.log("\n[smoke] listMemories({ contextId }):");
  const listed = await comind.listMemories({ contextId: ctx.id });
  console.log("  count:", listed.length);
  check("listMemories returns all seeded entries (unranked)", listed.length === contents.length, listed.length);

  console.log(`\n[smoke] ${failures === 0 ? "✅ PASS" : `❌ FAIL (${failures})`} — recall() + listMemories() work off the instance.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
