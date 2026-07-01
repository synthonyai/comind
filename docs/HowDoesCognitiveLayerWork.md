# How Does the Cognitive Layer Work?

> Reconstructed **from the Prisma schema as a statement of design intent** — i.e. what
> the data model says CoMind is *meant* to be, not necessarily what the runtime does
> today. Where the schema and the running code disagree, this document follows the
> schema. See `SchemaIntent_vs_ExtractionDirection.md` for that gap.
>
> Source: `prisma/schema.prisma`. Line references are to that file.

---

## The one-sentence model

CoMind is a memory that **takes in raw experience, derives meaning from it, links
things together, tracks how alive each memory is, and feeds all of that back into an
agent's goals** — a cognitive substrate, not a search index.

---

## Two layers of memory

The schema is built around a deliberate split between *what happened* and *what it
means*.

### Layer 1 — `MemoryEntry`: raw ingest (`schema.prisma:196`)

The unfiltered record of an observation or input. Key intent-bearing parts:

- **Content + embedding** — `content` (text) plus `contentEmbedding vector(1024)`. The
  vector is how memories are found by *meaning*, not keywords.
- **Source normalization** — `sourceType` / `sourceId` / `sourceUri` / `capturedAt`.
  The schema expects memories to arrive from many channels (manual, email, automation,
  voice, import), each traceable back to where it came from. CoMind is multi-source by
  design.
- **Importance** — `importanceScore` (default 0.5): how much this memory should weigh
  in retrieval.

### Layer 2 — `MemoryArtifact`: derived meaning (`schema.prisma:266`)

What the agent *concluded* from raw entries. Not raw input — a distilled unit of
meaning, produced by the memory critic. Its `type` is a controlled vocabulary
(`schema.prisma:23`):

```
DECISION · INSIGHT · FACT · TASK · QUESTION · CONSTRAINT · SUMMARY
```

Crucially, an artifact is a first-class cognitive citizen: it has **its own
`embedding vector(1024)`** (`schema.prisma:285`), so derived meaning can be retrieved
semantically alongside raw memories — the agent can recall its own past conclusions,
not just past inputs. It also carries `confidence` and the same operational signals as
entries.

---

## Memories are *alive*: operational signals

This is the part that most separates the schema's intent from an ordinary vector store.
Both `MemoryEntry` and `MemoryArtifact` carry **machine-native operational signals**
(`schema.prisma:222-227`):

| Field | Meaning (intent) |
|---|---|
| `accessScore` | How readily this memory surfaces — how "reachable" it is. |
| `consolidationScore` | How settled/established it is vs. still tentative. |
| `lastActivatedAt` | When it was last brought into active use. |
| `activationCount` | How often it has been activated — a use-frequency signal. |
| `confidence` | How much the system believes it. |

These describe a memory that **activates, decays, and consolidates over time** —
borrowing the language of how a mind strengthens what it uses and lets the rest fade.

**The schema means for these to drive retrieval.** The dead giveaway is the indexes:

```
@@index([contextId, accessScore])          // schema.prisma:255
@@index([contextId, consolidationScore])    // schema.prisma:256
@@index([lastActivatedAt])                   // schema.prisma:257
@@index([contextId, importanceScore, timestamp])  // schema.prisma:251
```

You only build indexes on a column if you intend to *query and rank on it*. The schema
is pre-wired so recall can say "give me the most reachable, most consolidated, most
important memories in this context" — efficiently.

---

## Memories are *connected*: the associative graph

A mind doesn't store facts in isolation; it relates them. The schema encodes this two
ways.

### `MemoryLink` — associations between entries (`schema.prisma:317`)

A typed, weighted, *explained* edge between two memories:

- `from` / `to` — the two memories.
- `type` — kind of relationship (default `"related"`).
- `weight` — how strong the association is.
- `rationale` — *why* the link exists.
- `attributionType` — who drew it (user / agent-inferred / system).

This is an associative memory graph: memories pull in related memories, with strength
and a reason attached.

### `derivedFrom` — lineage between entries (`schema.prisma:230-232`)

A self-relation: a memory can be **derived from** another memory. This captures
*evolution of thought* — how one observation grew out of an earlier one.

---

## Meaning is *traceable*: provenance

When the agent derives an artifact, the schema insists you can always ask "what made you
think that?"

### `ArtifactSourceLink` (`schema.prisma:300`)

Connects a derived `MemoryArtifact` back to the raw `MemoryEntry`(s) it came from, with:

- `attributionType` — defaults to `AGENT_INFERRED` (the agent connected the dots).
- `rationale` — the reasoning for the derivation.

So every conclusion the system reaches has a paper trail back to the evidence. This is
the **derivation/provenance** backbone — inspectability is built into the data model,
not bolted on.

---

## Everything serves *intent*: contexts, agents, goals

Memory doesn't float free — it lives inside a purpose.

### `Context` (`schema.prisma:92`) — a scoped mental space

Each context has rich, directive descriptive fields the agent reasons *within*:

- `seedIntent` — the north-star purpose of the space.
- `whyItMatters`, `direction`, `summary`, `description`.
- `themes`, `constraints`, `assumptions`, `values`.

Contexts are also **hierarchical** (`parentId` / `children`, `schema.prisma:114-116`):
a root context can hold sub-contexts, so intent flows from general to specific.

### `AgentProfile` (`schema.prisma:135`) — the mind that inhabits a context

Defines the agent's character and what it pays attention to:

- `directives` — behavioral instructions.
- `watchWords` — quick attention triggers.
- plus tone / formality / detail-level / custom instructions — *how* it speaks.

### `Goal` (`schema.prisma:340`) — what the context is trying to achieve

- `weight` (0–1) — how much each goal matters; **goals are meant to be the primary
  driver of what gets recalled**.
- hierarchical (`parent` / `children`), status-tracked (`ACTIVE`/`COMPLETED`/…).

### `GoalArtifactLink` (`schema.prisma:365`) — closing the loop into goal health

Links derived artifacts back to the goals they serve, with a `strength`. This is how the
system can eventually answer "how is this goal doing?" — by looking at what insights,
decisions, and facts have accumulated toward it.

---

## How a single "thought" is meant to flow

Putting the pieces together, the schema describes this loop:

1. **Ingest.** Raw input lands as a `MemoryEntry` (any source), gets embedded.
2. **Recall with intent.** When the agent is prompted, retrieval pulls candidates by
   semantic similarity *and re-ranks them by* the context's `seedIntent`, the active
   `Goal` weights, the agent's `directives`/`watchWords`/`values`, **and** each memory's
   operational signals (`importanceScore`, `accessScore`, `consolidationScore`,
   recency) — and can pull in **linked** memories and prior **artifacts**.
3. **Reason.** The agent acts on that assembled, intent-shaped context.
4. **Derive meaning.** The memory critic distills the interaction into one or more
   `MemoryArtifact`s (DECISION / INSIGHT / FACT / …), each embedded and linked back to
   its source entries via `ArtifactSourceLink`, and tied to the goals it serves via
   `GoalArtifactLink`.
5. **Update the living state.** Activated memories get their `accessScore` /
   `activationCount` / `lastActivatedAt` bumped; importance is re-weighted. What gets
   used grows stronger; what doesn't, fades.

Step 2 ("recall with intent") and step 4–5 ("derive + keep memories alive") are the
heart of what makes this a *cognitive* layer rather than a vector database with a chat
loop on top.

---

## What this is NOT

The schema is careful to keep two kinds of fields out of the cognitive logic:

- **App-layer / UI fields** — `mood`, `viewCount`, `chatInteractions`, soft-delete
  (`deletedAt`), `archivedAt`, `processingMetadata`. These exist for the journaling app,
  not for the memory model — they sit outside the library boundary.
- **A plain semantic search index.** Similarity is the *entry point* to recall, not the
  whole of it. The operational signals, links, provenance, and goal-weighting are what
  the schema adds on top — and they are the point.

---

*Note: this document describes the schema's **intent**. For where the current running
code does and doesn't yet realize this intent, see
`SchemaIntent_vs_ExtractionDirection.md`.*
