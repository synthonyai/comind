# Schema Intent vs. Extraction Direction

> Working note from the Phase 6 discussion. The question that reframed everything:
> **is the direction of the extraction honoring the intent declared in the Prisma
> schema, or quietly walking away from it?** The schema is the truest spec of what
> CoMind is meant to *be*. The runtime is just where it happens to be parked today.
>
> **Resolution (2026-06-26):** adopted. v0.1 now builds the cognitive core *before*
> freezing the public contract (brain-first, package-last), so we don't certify the thin
> runtime as the definition. Reflected in `PRD.md` and `BuildMap.md`.

---

## What the schema actually declares

Read `MemoryEntry` (`schema.prisma:218-236`) not as storage but as a thesis. It says
a memory is a thing that:

- **activates and decays** — `accessScore`, `consolidationScore`, `lastActivatedAt`,
  `activationCount`. And these aren't passive columns: there are **dedicated indexes**
  for them (`@@index([contextId, accessScore])`, `[contextId, consolidationScore]`,
  `[lastActivatedAt]`). You only build those indexes if you intend
  retrieval/consolidation to *query on them*.
- **has self-belief** — `confidence`.
- **lives in a weighted associative graph** — `MemoryLink` with `weight`, `type`, and
  a `rationale` for why the edge exists.
- **has provenance** — `derivedFrom`/`derivations`, `ArtifactSourceLink` with
  `rationale` and `attributionType`.
- **feeds a derived meaning layer** — `MemoryArtifact`, itself with its own
  `embedding(1024)`, its own operational signals, and `GoalArtifactLink` so artifacts
  report into **goal health**.

That schema is not describing a vector store. It's describing a memory that activates,
decays, consolidates, links, derives, and ties back to goals. That is the "intent" —
in the real sense of the word.

---

## The direction of travel

Now look at what the recall path actually consults:

```
similarity (0.4) + substring-keyword intention (0.3) + flat importance (0.2) + recency (0.1)
```

**Not one** of the machine-native signals the schema built indexes for participates.
No `accessScore`, no `consolidationScore`, no `activationCount`, no `confidence`, no
links, no derivation, no artifact embedding. The entire cognitive apparatus the schema
designed is dark, and the seam (`intentions.ts:291`) actively *narrows away* the few
fields that would even let it switch on.

So the direction isn't neutral. The regression oracle pins the thin runtime, every
phase faithfully reproduces "pgvector + keyword rerank," and **at Phase 9 we trim the
public surface and freeze the contract around that thin thing.** Extraction is a moment
of *definition* — and right now the thing we're about to define-and-ship as "the
cognitive layer" is a semantic vector store with a keyword reranker. The schema reaches
for a mind; the library we're carving is drifting toward a search index, and the gate
is what's pulling it down.

---

## The part that makes it fixable — where exactly the divergence lives

It is **not** lost everywhere yet, and that matters for what we do next:

- The **types** (Phase 1) carried the ambition — `MemoryLink`, `ArtifactSourceLink`,
  the operational-signal fields are in `lib/comind/types.ts`.
- The **store interface** (Phase 2) returns *rich* entries (`SimilarityHit { entry, distance }`).
- The divergence is concentrated in exactly two places:
  1. **the recall/rerank algorithm** (`searchWithIntention` throws the richness away
     and scores on keywords), and
  2. **the missing store methods** for links/provenance/activation, which were
     deferred to Phases 10/11/14.

So the schema's intent hasn't been abandoned in the data model or even in the
interfaces — it's been abandoned in *the recall logic and in which store verbs exist*.
That's recoverable, but only if we **reorder**: the corrected scope already puts the
cognitive wiring (11–14) in v0.1, yet the plan freezes the public surface at Phase 9 —
*before* it. Freezing the contract below the schema's intent and then shipping it to
third parties is the actual harm.

---

## The crux decision this forces

It's the old "extract the boundary" vs "extract the boundary **and wire the intent**"
fork — but now seen as: *do we let the current runtime define CoMind's public contract,
or do we hold the contract to the schema?*

Read: the schema is the spec, the runtime is just where it happens to be parked today,
and the extraction should not be allowed to ratify the parked version as the definition.

Concretely that means **don't do Phase 6's surface-shaping and don't go near Phase 9
until the recall contract reflects the schema** — at minimum:

- stop narrowing the seam,
- let `accessScore`/`confidence`/links inform rerank,
- add the store verbs for links/provenance so the public methods can express them.

The oracle *should* go red when we do this; that red is the schema reasserting itself
over the parked runtime.

---

## My own notes

<!-- space for Miro -->
