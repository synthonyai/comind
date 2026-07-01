# Characterization oracles

Behavioral gates that pin CoMind's cognitive contract so refactors can't silently
change it. They run the **real** runtime against the in-memory reference store
(`demo/inMemoryStore.ts`) with a deterministic stub embedder and stub LLM — so
they need **no database and no API keys**, and are safe in CI.

```bash
npm run characterize            # all four
npm run characterize:activation # Bucket B — the living loop (write side)
npm run characterize:artifact   # Bucket C — the meaning layer (artifact production)
npm run characterize:runagent   # Bucket E — the assembled-prompt path + decision trace
npm run characterize:recall     # Bucket A/B/C — intention-weighted rerank + artifact supersession
```

Each oracle prints per-assertion ✅/❌ and exits non-zero on any failure.

## What each one pins

- **activation** — the reinforcement rule (`nextActivation`): `accessScore += 0.1`,
  `consolidationScore = 0.3 + activationCount·0.05`, both clamped at 1. Every
  `MemoryStore` must apply it in `activateEntries` / `activateArtifacts`.
- **artifact** — `createArtifact` persists a typed artifact, keeps its embedding,
  retains provenance (source entry ids), and applies field defaults.
- **runagent** — the full `runAgent` path returns `{response, trace}`; the trace
  reports what was recalled, produced, and activated, and write-back actually
  lands in the store. Token budget `0` evicts all recall-driven blocks while the
  critic still produces.
- **recall** — recall is intention-weighted, not raw nearest-neighbor: memories
  aligned with the standing intention (seed intent, goals, directives, watch
  words) outrank off-topic distractors, and a derived artifact supersedes the raw
  entry it distilled.

## Relationship to the private Postgres oracles

These are the **Prisma-free ports** of the oracles that live in the private
`comind-vantage` monorepo (which run against Postgres + HuggingFace as the
live-backend regression harness). They pin the same behavioral contract against
the same runtime through the injected-store boundary.

One assertion does **not** port: goal-link **validation** (valid links kept,
cross-context/hallucinated ids dropped). In v0.1 goal links are write-only — the
`MemoryStore` read surface never returns them — so that behavior stays pinned only
by the private Postgres oracle. See the note in `artifact-oracle.ts`.
