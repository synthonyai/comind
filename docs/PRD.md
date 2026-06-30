# CoMind PRD v0.1

*Revised after design conversations (2026-06-26): personal app parked; associative links and cross-context identity deferred to v0.2 with their structure kept; build order is brain-first, package-last.*
*Updated 2026-06-27: the full **artifact layer** (Bucket C — typed-vocabulary production, semantic recall, living loop, goal links) is decided **IN scope**, superseding the earlier "leaning defer." v0.1 cognitive targets are now: weighting-driven recall, the artifact layer, and provenance.*

## Product Definition

CoMind is a cognitive layer for AI agents. It gives agents persistent memory, intention-weighted retrieval, contextual continuity, and a runtime loop for recall, reflection, and write-back.

CoMind is not the LLM itself and it is not the host application. It sits between local or application-specific agents and large language models, managing the cognitive substrate those agents need in order to act with continuity over time.

The current personal memory and reflection app is the reference implementation. The product is the underlying cognitive layer.

---

## Core Problem

LLMs are powerful reasoning engines, but they are episodic by default. They do not naturally preserve durable context, prioritize what matters, track changing goals, or decide what should be remembered after an interaction.

Most agent systems solve this with basic vector search or chat history. That is useful but incomplete.

CoMind solves a narrower and more specific problem: give agents a structured cognitive layer that remembers, retrieves, prioritizes, and updates context according to goals, values, directives, time, and significance.

---

## Target User

The primary v0.1 user is a developer building an AI agent or AI-enabled application that needs memory beyond a single prompt or chat session.

Examples:

- A developer building a personal assistant.
- A developer building a domain-specific agent for research, coaching, project work, health tracking, or decision support.
- A developer building a local agent or robot that needs continuity across observations and actions.
- A technical founder evaluating memory infrastructure for agentic applications.

---

## The v0.1 Goal

CoMind v0.1 should let a developer embed CoMind into an agent, app, robot, assistant, or workflow and give that agent durable cognitive continuity.

The developer should be able to:

- Store observations, user inputs, decisions, and interaction summaries as structured memory.
- Retrieve relevant memories using both semantic similarity and intention-aware scoring.
- Assemble a contextual packet for an agent or LLM call.
- Run a basic agent runtime that uses retrieved memory and writes back important new information.
- Inspect the memory and artifact records that shaped an agent response.

**v0.1 is two things at once: a clean extractable boundary AND a cognitive layer that is genuinely good to use.** The boundary is the *means*; a memory layer worth embedding is the *end*. The Prisma schema is the truest statement of what CoMind is meant to be — it already encodes a rich cognitive model (weighted memory, an associative link graph, derivation/provenance, a nested context structure with a core context). Only part of it is wired into the software. v0.1 wires the *core* of that model for real and leaves the rest **present as structure but with its behavior deferred**, so later versions turn capabilities on rather than rebuilding foundations.

**The cognitive targets that define "good" for v0.1** (wired for real and tested):
1. **Weighting-driven recall** — importance / access / consolidation signals genuinely influence what surfaces, not just sit in columns. *(Buckets A + B — done.)*
2. **The artifact layer (derived meaning, first-class)** — the critic produces the full 7-type vocabulary (not one hardcoded INSIGHT), embedded on creation; artifacts are recalled **by relevance** alongside entries (prefer-artifact dedup) and are alive in the use/decay loop; each links to the goals it serves. *(Bucket C — decided IN on 2026-06-27, superseding the earlier "leaning defer." The schema makes artifacts first-class cognitive citizens; a meaning layer that can't recall its own derived meaning by relevance undercuts the core pitch.)*
3. **Derivation / provenance** — artifacts trace back to their source entries (`ArtifactSourceLink`), making the layer inspectable and trustworthy to a developer plugging it in; surfaced in the decision trace.

**Approach: build the brain first, package it last.** Wire the cognitive core *before* freezing the public surface, so the library ends up shaped around the real thing — not around a half-built version frozen early.

**Deferred to v0.2 (kept as structure, behavior not built):** associative links (`MemoryLink`), and cross-context identity — a core context with overriding priority, promotion of shared learnings up to it, and alignment warnings when a sub-context conflicts with it. The tables, columns, and types for these stay in place so v0.2 is a switch-on, not a rebuild.

Discipline: wire the two targets for real; keep the rest structurally present without forcing behavior; don't gold-plate and don't hollow out. App-specific surface stays out, verified via the recall oracle and the reference demo rather than the app UI.

---

## Current Alpha State

The existing alpha already contains the core shape of the product:

- A Next.js application using TypeScript, Prisma, PostgreSQL, and pgvector.
- A `lib/comind/` library boundary intended to become the open-source core.
- A `MemoryEntry` model for raw ingested memories with 1024-dimensional embeddings.
- A `MemoryArtifact` model for derived meaning: insights, facts, decisions, questions, summaries.
- Contexts with seed intent, values, constraints, goals, assumptions, and direction.
- Agent profiles with directives, watch words, tone, knowledge domains, and custom instructions.
- Memory storage, update, and vector similarity search via pgvector.
- Intention-weighted retrieval combining semantic similarity, goal alignment, importance, and recency.
- A recall layer via `recallForContext(...)`.
- An agent runtime via `runAgent(...)`.
- A memory critic that creates derived artifacts and updates recalled memory stats.

The main v0.1 task is not to invent the system from scratch. It is to clarify, harden, and package the existing system as a developer-facing cognitive layer.

---

## Core Concepts

**MemoryEntry** — The raw memory unit. Stores content, metadata, source information, embedding, importance score, operational scores, timestamps, and links.

**MemoryArtifact** — A derived meaning object created by the memory critic. Represents insights, decisions, facts, questions, tasks, constraints, and summaries. Traces back to source entries via `ArtifactSourceLink`.

**Context** — A scoped cognitive space with seed intent, direction, values, constraints, assumptions, goals, and an associated agent profile.

**AgentProfile** — Configuration for how an agent operates inside a context. Includes directives, watch words, tone, detail level, formality, knowledge domains, reference models, and custom instructions.

**Intention-Weighted Retrieval** — Retrieval that combines semantic similarity with goal, seed intent, directive, value, watch-word, importance, and recency signals. Weight hierarchy: seed intent and high-priority goals outweigh directives, which outweigh watch words and values.

**Memory Critic** — Part of the agent runtime that evaluates whether a new interaction created something worth remembering, creates artifacts if so, and updates importance scores on recalled memories.

**Host Agent** — The external app, assistant, robot, or workflow that uses CoMind.

---

## Primary Workflow

1. A host agent or application sends a user message, observation, event, or task to CoMind.
2. CoMind identifies the active context and agent profile.
3. CoMind retrieves semantically similar memory candidates.
4. CoMind reranks candidates using intention signals (goals, seed intent, directives, watch words).
5. CoMind assembles a context packet containing relevant memories, recent context, goals, profile directives, values, and artifacts.
6. The host agent or runtime calls an LLM with this context.
7. The memory critic evaluates the interaction.
8. CoMind writes back important new artifacts or updates recalled memory stats.
9. The host agent responds or acts with continuity shaped by prior context.

---

## v0.1 Scope

The scope has two halves that serve each other: **A. Boundary & extraction** (the means) and **B. Cognitive wiring** (the end — the three targets above). The boundary work creates the seams that make the cognitive wiring sane and oracle-safe; the cognitive wiring is what makes the boundary worth having.

### In Scope — A. Boundary & extraction

**1. Storage abstraction interface**
Define a `MemoryStore` interface specifying what operations storage must support. Ship Prisma/pgvector as the default and only implementation. The interface exists so future adapters have a clear contract and so the library does not force Prisma on consumers. Do this now — the surface is at its smallest and this becomes significantly harder after the library expands.

**2. TypeScript-first type definitions**
Core types (`MemoryEntry`, `MemoryArtifact`, `Context`, `AgentProfile`) defined as plain TypeScript interfaces in the library. Prisma schema becomes one mapping of those types, not the source of truth. Library ships its own type definitions independent of `@prisma/client`.

**3. Configuration interface**
Single `createComind({ store, embeddings, llm })` factory. Consumer passes their implementations; library provides defaults. Removes hardcoded HuggingFace key, GPT-4o model, and Prisma calls from library internals.

**4. Clean library boundary**
`lib/comind/` fully extractable — no Next.js imports, no framework assumptions, no app-specific logic driving library behavior. All `// APP-LAYER:` flagged items resolved or documented.

**5. Stable public API**
Confirm and stabilize a small surface:

```ts
// Core — stable in v0.1
storeMemory(params)
retrieveMemory(params)
recallForContext(params)
runAgent(userId, contextId, userMessage, context?)

// Required for self-contained library
createContext(params)
createAgentProfile(params)
```

**6. Personal app parked (not a constraint)**
The Next.js personal memory app is set aside as a frozen snapshot — preserved in git, not co-evolved. It no longer gates the work. Its database columns stay intact (the library stops *using* app-only fields like `mood` but does not drop them), so the app can be reconnected later as just another host without a rebuild. The **reference demo (item 7) becomes the sole proving ground** that the library works.

**7. Reference demo**
A minimal demo outside the personal app flow showing a host agent using CoMind across multiple interactions. Should demonstrate:
- Same agent without CoMind: forgets context or behaves generically.
- Same agent with CoMind: recalls prior goals, preferences, corrections.
- Inspectable recall: shows which memories shaped the response.
- Inspectable write-back: shows what the memory critic saved or updated.

### In Scope — B. Cognitive wiring (the v0.1 targets)

**8. Weighting-driven recall**
Make the operational signals already on `MemoryEntry`/`MemoryArtifact` — `importanceScore`, `accessScore`, `consolidationScore`, `activationCount`, `lastActivatedAt` — genuinely participate in retrieval and ranking, and update on recall. Today several are stored but under-used. Wire them so weighting is a real, inspectable input to what surfaces. (This is the one place where "recall weight tuning," previously out of scope, becomes in-scope — as *wiring*, not endless tuning.) *(Buckets A + B — done.)*

**9. The artifact layer (first-class derived meaning)** *(Bucket C — decided IN 2026-06-27)*
Make `MemoryArtifact` the first-class cognitive citizen the schema specifies. (a) The critic produces **multiple typed artifacts per turn** across the full 7-type vocabulary, **embedded on creation**. (b) Artifacts are **recalled semantically alongside entries** through the same rerank; when a conclusion and its source both match, **prefer the artifact** (source collapses under it via provenance). (c) The **living loop applies to artifacts** (reuse item 8's reinforcement). (d) Each artifact links to the **goals it serves** via `GoalArtifactLink` (strength + rationale), with the **critic deciding** the links in the fused call. **No DB migration** — the artifact embedding column already exists, and search uses exact `<->` scan exactly as entries do today (ANN indexing via HNSW for both tables is a later perf pass, not v0.1; decided 2026-06-27).

**10. Derivation / provenance**
Populate and surface `ArtifactSourceLink` so every artifact the critic creates records which source entries it derived from (with attribution + rationale), and expose that lineage in the decision trace. This is what makes the layer inspectable and trustworthy.

> Scope discipline for B: wire each target as real, tested behavior verified by the recall oracle / reference demo. Structural presence in the types is mandatory; full behavioral richness can land incrementally. Stop at "good," not "exhaustive."

### Out of Scope

- Publishing to npm
- Full developer documentation (minimal inline docs and a reference demo are in scope; a full doc site is not)
- Additional storage adapters (MongoDB, SQLite, etc.)
- New cognitive features *beyond* wiring the v0.1 targets (e.g. critic split / mini-model critic, configurable embedding dimension). *(Note: critic-chosen artifact types are now IN scope — see item 9, Bucket C.)*
- **Associative links** (`MemoryLink`) behavior — deferred to v0.2; the table, indexes, and core types stay in place so it's a switch-on later
- **Cross-context identity (#5)** — a core context with overriding priority, promotion of shared learnings to it, and alignment warn/ask when a sub-context conflicts — deferred to v0.2; the nested-context structure stays in place
- Consumer-grade UI polish in the reference app
- Hosted SaaS product
- Marketplace or plugin ecosystem
- Multi-user / org workflows
- Local/private LLM routing
- Production billing or enterprise administration
- Open-ended tuning of recall weights (wiring the weighting signals into recall **is** in scope per item 8; chasing optimal weight values is not)

---

## Key Technical Components

| Module | Status | v0.1 Work |
|---|---|---|
| `lib/comind/memory.ts` | Working | Wrap behind MemoryStore interface |
| `lib/comind/store.ts` | Working | Thin — feeds interface |
| `lib/comind/list.ts` | Working | Thin — feeds interface |
| `lib/comind/recall.ts` | Working | Has APP-LAYER flags; clean up |
| `lib/comind/intentions.ts` | Updated | Clean — no v0.1 work needed |
| `lib/comind/feedback.ts` | New | Clean — no v0.1 work needed |
| `lib/comind/agentRuntime/` | Working | Wrap LLM call behind LLMProvider interface |
| `lib/embeddings.ts` | Working | Wrap behind EmbeddingProvider interface |
| `lib/llm.ts` | Working | Wrap behind LLMProvider interface |

Known app-layer concepts currently touching the library (tracked, not urgent):
- `mood`, `viewCount`, `chatInteractions` — stored/returned but not driving logic
- `preview` truncations in `recall.ts` — UI shaping
- `goals` field naming used for app compatibility where `directives` is more accurate

---

## Success Criteria

1. A developer can embed CoMind into a non-Next.js project by implementing three interfaces: `MemoryStore`, `EmbeddingProvider`, `LLMProvider`.
2. No Prisma, Next.js, or OpenAI imports leak through `lib/comind/index.ts` into consumer code.
3. Core types are defined as plain TypeScript interfaces, not derived from Prisma.
4. The personal memory app is cleanly parked (frozen in git, database columns intact) and can be reconnected later without a rebuild.
5. The reference demo clearly shows continuity that basic chat history or vector search alone would not provide.
6. Retrieval is inspectable — it is possible to explain why a memory was selected.
7. The memory critic creates useful artifacts without polluting memory on every interaction.

---

## Open Questions

1. **`recallForContext` vs `assembleContextPacket`** — should `recallForContext(...)` be the public context assembly API, or does it get replaced with a cleaner name that better reflects its role?
2. **`MemoryArtifact` in retrieval** — ~~should artifacts be first-class in semantic retrieval alongside entries?~~ **Resolved (2026-06-25):** yes, this is now in scope. Artifacts get embedded on create and become retrieval-capable; merged artifact+entry retrieval is part of the cognitive wiring (see In Scope B), not deferred.
3. **Memory critic scope** — should the critic create artifacts only, or also create new `MemoryEntry` records for certain summaries?
4. **Embedding model flexibility** — the 1024-dim assumption is baked into the schema. How flexible does this need to be for v0.1?
5. **Package naming** — is `comind` the right name for the open-source package, or does it need a more neutral name separate from the CoMind brand?
6. **First public demo** — personal memory app, simulated robot, CLI agent, or minimal API example?

---

## What This Is Not

CoMind is not a vector database. It is not a RAG framework. It is not a general-purpose agent framework. It is not an autonomous agent platform.

It is specifically the memory and consolidation layer — the thing that sits between raw agent inputs and meaningful, weighted, retrievable knowledge — designed to work with any agent runtime that can call a function.

---

## Immediate Next Steps

1. Confirm the v0.1 public API surface and mark each `lib/comind` function as core, app-layer, or transitional.
2. Define `MemoryStore`, `EmbeddingProvider`, and `LLMProvider` interfaces.
3. Wrap existing Prisma/HuggingFace/OpenAI implementations behind those interfaces.
4. Build the reference demo.
