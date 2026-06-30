/**
 * Shared world-seeding for the reference demo — the host's setup step.
 * ---------------------------------------------------------------------------
 * Both surfaces stand on the same seed: Rung 1/2 (`play.ts`, the scripted
 * transcript + TUI) and Rung 3 (`repl.ts`, the interactive driver). Seeding a
 * `WorldSeed` is pure host work — context + agent profile + weighted goals +
 * any pre-seeded memories, all through the `MemoryStore` contract, never Prisma.
 * Pulling it here keeps the two drivers honest: they prove the SAME world, so a
 * difference between them is a difference in *driving*, not in setup.
 */

import type { EmbeddingProvider, MemoryStore } from "@/lib/comind";
import type { WorldSeed } from "@/demo/scenarioTypes";

export interface SeededWorld {
  /** The context the case runs in. */
  ctxId: string;
  /** Logical goal key (from `WorldSeed.goals[].key`) → the id minted this run. */
  goalKeyToId: Record<string, string>;
}

/** Seed a world through the store; returns the ids a driver needs to run it. */
export async function seedWorld(
  store: MemoryStore,
  embeddings: EmbeddingProvider,
  world: WorldSeed,
): Promise<SeededWorld> {
  const ctx = await store.createContext({
    name: world.context.name,
    seedIntent: world.context.seedIntent,
    direction: world.context.direction,
    values: world.context.values,
    constraints: world.context.constraints,
  });

  await store.createAgentProfile({
    homeContextId: ctx.id,
    name: world.profile.name,
    description: world.profile.description,
    directives: world.profile.directives,
    watchWords: world.profile.watchWords,
  });

  const goalKeyToId: Record<string, string> = {};
  for (const g of world.goals) {
    const goal = await store.createGoal({ contextId: ctx.id, title: g.title, weight: g.weight });
    goalKeyToId[g.key] = goal.id;
  }

  for (const m of world.seedMemories ?? []) {
    await store.createMemoryEntry({
      contextId: ctx.id,
      type: "NOTE",
      content: m.content,
      tags: m.tags,
      attributionType: m.attributionType,
      importanceScore: m.importanceScore,
      embedding: await embeddings.embed(m.content),
    });
  }

  return { ctxId: ctx.id, goalKeyToId };
}
