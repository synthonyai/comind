/**
 * Boundary check (PRD success criterion #2): importing the @/lib/comind barrel
 * and constructing createComind with injected providers must NOT load Prisma,
 * @prisma/client, Next, or OpenAI into the module graph. Run with NO DATABASE_URL.
 *
 *   npx ts-node ... demo/checkBarrelClean.ts
 */

import { createComind } from "@/lib/comind";
import { InMemoryMemoryStore } from "@/demo/inMemoryStore";

function loadedModules(): string[] {
  // CommonJS (ts-node) — require.cache keys are resolved file paths.
  return Object.keys((require as unknown as { cache: Record<string, unknown> }).cache ?? {});
}

const FORBIDDEN = ["@prisma/client", "/lib/comind/prisma", "/.prisma/", "openai", "next/"];

function offenders(): string[] {
  return loadedModules().filter((m) => FORBIDDEN.some((f) => m.includes(f)));
}

// 1. After importing the barrel + constructing with injected providers.
const store = new InMemoryMemoryStore();
createComind({
  userId: "boundary-check",
  store,
  embeddings: { dimensions: 4, embed: async () => [0, 0, 0, 0], embedQuery: async () => [0, 0, 0, 0] },
  llm: { generateStructured: async () => ({}) as never },
});

const bad = offenders();
if (bad.length === 0) {
  console.log("✅ barrel is clean — no Prisma/OpenAI/Next loaded by importing + constructing createComind.");
} else {
  console.log("❌ boundary leak — these modules were loaded:");
  bad.forEach((m) => console.log("   " + m));
  process.exitCode = 1;
}
