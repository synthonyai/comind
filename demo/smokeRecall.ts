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
  await store.createAgentProfile({
    homeContextId: ctx.id,
    description: "Architecture guide",
    directives: ["record decisions with rationale"],
    watchWords: ["database", "storage"],
  });
  const goal = await store.createGoal({ contextId: ctx.id, title: "Ship the single-store architecture", weight: 0.8 });

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

  console.log("\n[smoke] wake(ctx) — assemble the continuity state (item B):");
  const state = await comind.wake(ctx.id);
  console.log("  governing.context.seedIntent:", state.governing.context?.seedIntent);
  console.log("  governing.agentProfile.directives:", state.governing.agentProfile?.directives);
  console.log("  foreground.activeGoals:", state.foreground.activeGoals.map((g) => g.title));
  check("wake loads the governing context frame", state.governing.context?.id === ctx.id);
  check("wake loads the agent profile (governing)", (state.governing.agentProfile?.directives.length ?? 0) > 0);
  check("wake puts active goals in the foreground", state.foreground.activeGoals[0]?.id === goal.id);
  check("carryover is an honest empty slot (item C fills it)", state.carryover.summary === null);
  check("promoted starts empty (nothing promoted yet)", state.promoted.artifacts.length === 0);

  console.log("\n[smoke] re-wake — stateless ≠ discontinuous (reconstructs from data):");
  const state2 = await comind.wake(ctx.id);
  check("re-wake reconstructs the same frame (nothing kept warm)",
    state2.governing.context?.id === state.governing.context?.id &&
    state2.foreground.activeGoals.length === state.foreground.activeGoals.length);

  console.log(`\n[smoke] ${failures === 0 ? "✅ PASS" : `❌ FAIL (${failures})`} — recall() + listMemories() + wake() work off the instance.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
