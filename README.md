# CoMind Core

[![CI](https://github.com/synthonyai/comind/actions/workflows/ci.yml/badge.svg)](https://github.com/synthonyai/comind/actions/workflows/ci.yml)
[![License: MPL 2.0](https://img.shields.io/badge/License-MPL_2.0-brightgreen.svg)](https://www.mozilla.org/en-US/MPL/2.0/)

**A cognitive continuity layer for AI agents.**

```bash
npm install @comind-ai/core
```

CoMind Core gives an AI agent more than recall. It gives it a way to organize what it knows,
decide what matters, preserve useful conclusions, and wake back up with the same orientation
it had before.

Use CoMind Core when you need an agent that can:

- **Continue instead of restart** — wake up already knowing its role, goals, open threads, and
  standing conclusions.
- **Remember in a structured way** — store observations as typed memories and reusable
  conclusions, not just a transcript dump.
- **Retrieve by purpose, not just keywords** — surface what matters for the current intent,
  goal, or task.
- **Know why it believes something** — keep receipts linking conclusions back to the
  observations that produced them.
- **Let important conclusions stick** — promote key beliefs across sessions without turning
  them into invisible hard-coded rules.
- **Stay backend-agnostic** — plug in your own database, embedding provider, and LLM.
- **Expose its reasoning path** — inspect what was recalled, selected, promoted, and used.

CoMind does not just help an agent find old memories. It helps the agent maintain an organized
state of what it is, what it is doing, and what it currently believes.

Most "agent memory" systems are vector stores: they embed past text and retrieve nearby matches
when asked. CoMind Core is designed as a cognitive layer above storage. It helps an agent decide
what is worth keeping, turns raw observations into reusable conclusions, recalls memories through
the lens of current intent, and assembles a continuity state before the next interaction begins.

It is backend-agnostic by construction. You bring a store, an embedder, and an LLM by
implementing three small interfaces. CoMind Core ships no built-in database and no required app
framework. The demos run the real runtime with an in-memory store and no API keys.

> **Status: v0.2 — continuity.**
> v0.1 introduced the core memory loop: intent-based recall, typed conclusions, source receipts,
> and reinforcement by use. v0.2 adds continuity: the ability for an agent to wake with its
> profile, goals, promoted beliefs, and open thread already assembled.

---

## The core idea

LLMs are powerful, but they usually start over every session. They do not naturally carry
forward what they are, what they are trying to do, what they learned last time, or which
conclusions are important enough to keep close.

CoMind Core gives the host application a way to preserve that orientation.

An agent backed by CoMind can wake into a standing continuity state before the next user message
arrives. That state can include its profile, directives, goals, open thread, promoted
conclusions, and relevant memories selected for the current focus.

This means the agent does not have to reconstruct itself from a giant prompt or rediscover the
same facts from a vector search every time. It can resume from an organized cognitive state.

```ts
import { createComind } from "@comind-ai/core";

const comind = createComind({ userId, store, embeddings, llm });

const mind = await comind.wake(contextId);
// mind contains the agent's standing orientation:
// who it is · what it is working toward · where it left off · what it currently believes

await comind.checkpoint(contextId, "We paused while comparing the two memory designs.");

const nextMind = await comind.wake(contextId);
// nextMind can now include the open thread from the previous session.
```

You can also clear learned memories without deleting the agent's profile, goals, and continuity
state:

```ts
await comind.clear(contextId);

const stillOriented = await comind.wake(contextId);
// The agent can return with its standing orientation intact,
// even though learned/session memories were cleared.
```

---

## Try the v0.2 continuity demo

Start here:

```bash
npm install
npm run demo:awaken
npm run demo:awaken -- --step
npm run demo:wake
```

`demo:awaken` — "The Mind That Wakes" — shows an agent waking mid-task, receiving a new
priority, reordering what matters, strengthening a conclusion through use, and returning after
memory is cleared.

The v0.2 demos need no keys.

---

## What v0.2 does

- **Wakes up oriented.**
  `wake()` assembles the agent's standing state before input: profile, goals, carryover,
  promoted beliefs, and relevant memories.
- **Picks up where it left off.**
  `checkpoint()` saves the open thread at the end of a session. The next `wake()` reads it
  first, so the agent can resume instead of restart.
- **Keeps important conclusions close.**
  `promote()` keeps a useful conclusion present across sessions. `demote()` lets it go. A
  promoted conclusion is still inspectable and revisable; it is not silently turned into a hidden
  rule.
- **Can clear learned memory without deleting orientation.**
  `clear()` forgets learned/session memories while keeping the agent's profile, goals, and
  continuity state intact.
- **Answers "what do you know?" directly.**
  `recall()` returns the memories that matter to a question, ranked by intent. `listMemories()`
  lists what is stored.

---

## The instance surface

`createComind(...)` returns an object with these verbs:

| Verb | What it does |
|---|---|
| `wake(contextId, { focusQuery? })` | Assemble the agent's standing continuity state before input. |
| `recall(contextId, query, opts?)` | Return intent-ranked memories and artifacts without running a full agent turn. |
| `listMemories(filters)` | List stored memory entries directly. |
| `checkpoint(contextId, summary, opts?)` | Save the open thread so the next wake can resume from it. |
| `promote(artifactId)` / `demote(artifactId)` | Keep a conclusion present across sessions, or let it go. |
| `clear(contextId)` | Forget learned/session memories while keeping profile, goals, and continuity state. |
| `reply(contextId, message, opts?)` | A guide turn, step 1: recall, then stream the reply. Returns `{ input, stream }` — `input` is exactly what the guide was given. |
| `extract(input, response)` | A guide turn, step 2: distil decisions, insights, tasks… from the exchange and store them with their sources. You decide when it runs. |
| `runAgent(contextId, message, opts?)` | Both steps without streaming; returns `{ response, trace, input }`. |
| `link(...)` / `listLinks(...)` | Connect two memories with a typed edge of your own vocabulary, and read those edges. |
| `storeMemory(params)` | Store a raw observation (optionally linked to earlier ones). Importance is judged against the agent's current goals. |
| `createContext` / `createGoal` / `createAgentProfile` | Set up who the agent is and what it is working toward. |

For hosts and tests, the wake logic is also exported as a standalone function:

```ts
assembleContinuityState(inputs)
```

`wake()` is the convenience shortcut over it.

---

## What v0.1 added first

Before v0.2 continuity, CoMind Core introduced the basic memory loop:

- **Stores memories as meaning, not just text.**
  Raw observations can become typed conclusions such as `FACT`, `DECISION`, `CONSTRAINT`,
  `QUESTION`, `TASK`, `INSIGHT`, and `SUMMARY`.
- **Selects by intent, not just similarity.**
  Recall is weighed against the agent's standing lens: directives, values, goals, and current
  focus.
- **Keeps receipts.**
  Every conclusion can point back to the observations that produced it.
- **Reorganizes through use.**
  Memories that get used can grow stronger. Memories that are ignored can fade.
- **Returns an inspectable trace.**
  `runAgent()` returns `{ response, trace }`, so hosts can inspect what was recalled, selected,
  used, and stored.
- **Avoids memory hoarding.**
  CoMind selects a small set of relevant memories per turn instead of dumping the whole history
  back into context.

---

## Try the v0.1 memory demo

The v0.1 robot-detective demo is the clearest boundary proof for intent-based recall. Between
dispatches, the conversation window is wiped, so anything the agent still knows had to live in
CoMind, not in the prompt:

```bash
npm run demo:play -- --offline
npm run demo:tui  -- --offline
npm run demo:repl -- --offline
npm run demo:prove
```

The v0.1 demos take `--offline` for deterministic, no-key runs. Drop `--offline` to use real
providers with keys in `.env` using the example in `.env.example`.

---

## The boundary: three interfaces

You embed CoMind Core by implementing three providers and passing them to `createComind`:

| Interface | Responsibility |
|---|---|
| `MemoryStore` | Where memories live and how to find them. |
| `EmbeddingProvider` | Converts text into vectors. |
| `LLMProvider` | Talks to a language model: fills CoMind-owned schemas and streams replies. Every call names its job (`reply`, `extraction`…), so you can use a different model per job. |

```ts
import { createComind } from "@comind-ai/core";

const comind = createComind({
  userId: "tenant-1",
  store,       // your MemoryStore
  embeddings,  // your EmbeddingProvider
  llm,         // your LLMProvider
});

const { response, trace } = await comind.runAgent(
  contextId,
  "Who do we suspect?"
);
```

Default adapters for HuggingFace embeddings and OpenAI ship in
`lib/comind/adapters/`. You can import and inject those, or write your own.

---

## The proof it holds

CoMind Core is not tied to Prisma, Postgres, OpenAI, or any app framework.

```bash
npm run demo:prove
```

This runs the real `runAgent` against a non-Prisma in-memory store, with no database and no API
keys.

```bash
npm run demo:check
```

This asserts that importing and constructing the public barrel does not load Prisma or OpenAI.

```bash
npm run typecheck   # tsc --noEmit
```

`demo/inMemoryStore.ts` is a pure-TypeScript `MemoryStore` with cosine similarity and no SQL. It
exists to prove that a non-default backend satisfies the contract.

---

## What v0.2 does not do yet

CoMind Core ships what it can prove, and is explicit about the current edge.

- **The agent wakes when you ask it to.**
  v0.2 gives you `wake()`. The host calls it. The layer that keeps an agent awake on its own,
  refreshing itself as things happen, is the Memory Engine, planned for v0.3.
- **Recall is not yet fully meaning-native.**
  Today, new memory importance is judged against the agent's goals by meaning. Deeper
  meaning-based matching across all recall paths is planned for v0.3.
- **Related-memory linking is still ahead.**
  Future versions will handle stronger links between memories, competing conclusions, conflicts
  between beliefs, and richer identity handling.

The design notes in `docs/` explain where the current boundary is drawn and why.

---

## Layout

```
lib/comind/          the library
  providers.ts       the three interfaces and their IO types
  index.ts           the public barrel
  continuity.ts      wake → the standing continuity packet
  agentRuntime/      the loop: recall → prompt → LLM → memory critic
  adapters/          default HuggingFace and OpenAI providers
demo/                reference demos (in-memory store; detective demo; awake panel)
docs/                PRDs, build map, design notes, schema reference
```

`docs/schema-reference.prisma` is the full data model the core types map to. It is kept as a
design reference. The library itself ships no database.

---

## License

[MPL-2.0](./LICENSE) — file-level copyleft with a patent grant.

You can embed CoMind Core in a closed product. Improvements to CoMind Core's own source files
flow back.
</content>
