/**
 * Artifact-production characterization (Bucket C / P1 — the meaning layer)
 * --------------------------------------------------------------------------
 * Derived artifacts are first-class: the critic emits 0..n TYPED artifacts, each
 * persisted with its embedding (so P2 can recall it semantically) and wired to
 * its source entries (provenance). This pins the store's write side: a
 * `MemoryStore.createArtifact` must persist the typed artifact, keep the
 * embedding it was given, retain provenance, and apply field defaults.
 *
 * Prisma-free port of the private `artifact-production-oracle.ts`. Assertion-based.
 *
 * Coverage note: the private oracle also asserts goal-link VALIDATION (valid links
 * kept, cross-context/hallucinated ids dropped). In v0.1 goal links are write-only
 * — the MemoryStore read surface never returns them (see inMemoryStore.ts) — so
 * that validation is not observable here and stays pinned by the private Postgres
 * oracle. We assert only that createArtifact ACCEPTS goalLinks without error.
 *
 * Usage: npm run characterize:artifact
 */

import { InMemoryMemoryStore } from "@/demo/inMemoryStore";
import { StubEmbeddings, makeChecker } from "@/characterization/stubs";

async function main() {
  const { check, checkTrue, report } = makeChecker("artifact");
  const store = new InMemoryMemoryStore();
  const embeddings = new StubEmbeddings();

  const ctx = await store.createContext({ name: "Artifact Context" });
  const e1 = await store.createMemoryEntry({
    contextId: ctx.id,
    type: "NOTE",
    content: "We chose Postgres over Mongo for relational integrity.",
  });
  const e2 = await store.createMemoryEntry({
    contextId: ctx.id,
    type: "NOTE",
    content: "pgvector handles the embeddings in the same store.",
  });
  const goal = await store.createGoal({
    contextId: ctx.id,
    title: "Ship the single-store architecture",
    weight: 0.8,
  });
  const sourceIds = [e1.id, e2.id];

  /** Provenance is exposed on the artifact similarity hit, not on getArtifact. */
  async function sourceIdsOf(artifactId: string): Promise<string[]> {
    const hits = await store.searchSimilarArtifacts({
      contextId: ctx.id,
      vector: await embeddings.embedQuery("datastore decision"),
      limit: 50,
    });
    const hit = hits.find((h) => h.artifact.id === artifactId);
    return hit ? [...hit.sourceEntryIds] : [];
  }

  // --- A typed artifact with explicit sources ------------------------------
  const content = "Adopt Postgres + pgvector as the single store.";
  const created = await store.createArtifact({
    contextId: ctx.id,
    type: "DECISION",
    content,
    title: "Datastore decision",
    confidence: 0.9,
    tags: ["datastore", "decision"],
    embedding: await embeddings.embed(content),
    sourceEntryIds: sourceIds,
  });
  const row = (await store.getArtifact(created.id))!;

  console.log("[artifact] persisted artifact:");
  check("type", row.type, "DECISION");
  check("content", row.content, content);
  check("title", row.title, "Datastore decision");
  check("confidence", row.confidence, 0.9);
  check("tags", row.tags, ["datastore", "decision"]);

  console.log("[artifact] embedding (the P1 unlock — populated on creation):");
  checkTrue("embedding is non-null", row.embedding !== null);
  check("embedding dims match embedder", row.embedding?.length ?? 0, embeddings.dimensions);

  console.log("[artifact] provenance:");
  check("source id count", (await sourceIdsOf(created.id)).length, 2);
  check("source ids match (sorted)", (await sourceIdsOf(created.id)).sort(), [...sourceIds].sort());

  // --- Defaults when optional fields are omitted ---------------------------
  const minimal = await store.createArtifact({
    contextId: ctx.id,
    type: "INSIGHT",
    content: "The store choice keeps recall and persistence in one place.",
    sourceEntryIds: [],
  });
  const minRow = (await store.getArtifact(minimal.id))!;
  console.log("[artifact] minimal artifact (defaults):");
  check("type", minRow.type, "INSIGHT");
  check("default confidence", minRow.confidence, 0.7);
  check("default tags empty", minRow.tags, []);
  check("title null", minRow.title, null);

  // --- Goal links accepted (validation pinned only by the private oracle) ---
  const linked = await store.createArtifact({
    contextId: ctx.id,
    type: "INSIGHT",
    content: "Keeping recall and persistence in one store advances the architecture goal.",
    sourceEntryIds: [],
    goalLinks: [
      { goalId: goal.id, strength: 0.9, rationale: "Directly realizes the single-store design." },
      { goalId: "nonexistent-goal-id", strength: 0.5, rationale: "Hallucinated id — dropped by the store." },
    ],
  });
  console.log("[artifact] goal links (P4 — accepted without error):");
  checkTrue("createArtifact with goalLinks returns an artifact", typeof linked.id === "string" && linked.id.length > 0);

  report();
}

main().catch((e) => {
  console.error("[artifact] error:", e);
  process.exitCode = 1;
});
