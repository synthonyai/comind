# CoMind

[![CI](https://github.com/synthonyai/comind/actions/workflows/ci.yml/badge.svg)](https://github.com/synthonyai/comind/actions/workflows/ci.yml)
[![License: MPL 2.0](https://img.shields.io/badge/License-MPL_2.0-brightgreen.svg)](https://www.mozilla.org/en-US/MPL/2.0/)

**A portable cognitive layer for AI agents.** Most "agent memory" is a vector store: it
embeds text and hands back the nearest neighbours. CoMind is the layer above that — it
*selects by intent*, *distills raw observations into typed conclusions*, *keeps a paper
trail*, and *reorganizes itself by use* — and it does all of this behind an inspectable
runtime you can open up and watch.

It is **backend-agnostic by construction**: you bring a store, an embedder, and an LLM by
implementing three small interfaces. There is no built-in database — the reference demo
runs the *real* runtime against a pure in-memory store with no Postgres and no API keys.

> Status: **v0.1**. The cognitive core and the boundary are done and proven; the personal
> journaling app that seeded this project is parked. This repo is the library + a reference
> demo + the design docs.

---

## See it first

The demo is a robot detective working a case across "dispatches." Between dispatches its
conversation window is wiped — so anything it still knows had to live in CoMind, not in the
prompt. The right-hand panel renders the mind each turn: the standing identity lens, the
ranked recalled memories with intention scores, the typed conclusions it forms, and the
provenance behind each one.

```bash
npm install

npm run demo:play -- --offline   # scripted transcript, deterministic, no keys
npm run demo:tui  -- --offline   # the live split-pane mind panel
npm run demo:repl -- --offline   # drive the case yourself (recall-only offline)

npm run demo:prove               # the boundary proof (see below)
```

Drop `--offline` to run against real providers (HuggingFace embeddings + OpenAI) — set the
keys in `.env` (see `.env.example`). Offline swaps in deterministic stubs and needs nothing.

---

## What it actually does (v0.1)

- **Selection by intent, not just similarity** — recall is re-ranked by a standing identity
  (directives, values, watch-words) plus weighted goals, so the *same* memory pile surfaces
  different memories as focus shifts.
- **A typed meaning layer** — a memory critic distills raw observations into typed
  artifacts (`FACT`, `DECISION`, `CONSTRAINT`, `QUESTION`, `TASK`, `INSIGHT`, …), embedded on
  creation and recalled alongside raw entries, with the source collapsing under the
  conclusion (prefer-artifact).
- **Provenance** — every conclusion points back at the exact observations that produced it.
- **A living loop** — recalled memory is reinforced and rises; ignored memory decays — a
  ranking that moves, not a flat pile.
- **An inspectable runtime** — `runAgent` returns `{ response, trace }`; the `DecisionTrace`
  is the whole decision, openable.
- **A token budget** — a handful of *selected* memories per turn, not the whole history
  re-dumped.

---

## The boundary: three interfaces

You embed CoMind by implementing three providers and passing them to `createComind`:

| Interface | Responsibility |
|---|---|
| `MemoryStore` | where memories live + how to find them (similarity search, goals, context) |
| `EmbeddingProvider` | text → vector |
| `LLMProvider` | fill a CoMind-owned schema from a prompt |

```ts
import { createComind } from "@synthonyai/comind";

const comind = createComind({
  userId: "tenant-1",
  store,        // your MemoryStore
  embeddings,   // your EmbeddingProvider
  llm,          // your LLMProvider
});

const { response, trace } = await comind.runAgent(contextId, "who do we suspect?");
```

Default adapters for **HuggingFace** embeddings and **OpenAI** structured output ship in
`lib/comind/adapters/` — import and inject them, or write your own.

### The proof it holds

```bash
npm run demo:prove   # runs the REAL runAgent against a non-Prisma in-memory store,
                     # with no DB and no API keys, and asserts nothing heavy loaded.
npm run demo:check   # asserts importing + constructing the barrel loads no Prisma/OpenAI.
npm run typecheck    # tsc --noEmit
```

`demo/inMemoryStore.ts` is a pure-TypeScript `MemoryStore` (cosine similarity, no SQL) — the
existence proof that a non-default backend satisfies the contract.

---

## Layout

```
lib/comind/          the library (the product)
  providers.ts       the three interfaces + their IO types
  index.ts           the frozen public barrel
  agentRuntime/      the CAMA loop: recall → prompt → LLM → memory critic
  adapters/          default HuggingFace + OpenAI providers
demo/                the reference demo (in-memory store + the robot-detective case)
docs/                PRD, build map, design notes, schema reference
```

`docs/schema-reference.prisma` is the full data model the core types map to — kept as a
design reference; the library itself ships no database.

---

## License

[MPL-2.0](./LICENSE) — file-level copyleft with a patent grant. You can embed CoMind in a
closed product; improvements to CoMind's own source files flow back.
