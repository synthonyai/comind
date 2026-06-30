# CoMind Build Map

> **What this is.** The single master build map for CoMind's cognitive layer — turning it
> into an honest, portable mind that *selects by intent*, not just stores and retrieves, and
> extracting it as a library a host application (digital **or** embedded) can build on. It
> documents the **full MVP** and marks what's in the **v0.1 carve** vs **deferred to v0.2**.
> (Formerly `BuildMap_v0.2.md`; renamed 2026-06-27 since it governs both releases — "v0.2"
> in the name was misreading as a separate, later doc.)
>
> **v0.1 carve** = the boundary/extraction + three cognitive targets — weighting-driven
> recall (Buckets A+B, **done**), the full artifact layer (Bucket C, **done 2026-06-27** —
> P1–P4 committed), and provenance — with the personal app **parked**. **Bucket E (extract +
> freeze the contract) is now done too (`43dc063`) — all v0.1 buckets complete.** The only
> remaining v0.1 work is the **reference demo** (the proving ground; not a bucket).
> **Deferred to v0.2** (kept as structure so they're a switch-on, detailed in *v0.2
> (deferred) — detail* near the bottom): Bucket D (cross-context identity #5) and
> associative links (#7). See *Relationship to v0.1* for the full mapping.
>
> Companion docs:
> - `HowDoesCognitiveLayerWork.md` — what the cognitive layer *is*, from schema intent.
> - `SchemaIntent_vs_ExtractionDirection.md` — the gap between schema intent and the
>   current extraction direction (why we don't freeze the contract around the thin runtime).

---

## The headline

**We are not recreating.** The two expensive things — the Prisma schema and the recall
algorithm — already exist. The schema already provides every structure the MVP needs:
the context tree with a root, weighted goals, artifacts with (dormant) embeddings,
provenance links, and operational-signal columns *with indexes already built for them*.

The work is three kinds, in increasing size:

1. **Un-hollow** what's built but starved (mostly *deletion*).
2. **Finish wiring** what's half-connected.
3. **Build one genuinely new thing** — root promotion / override (cross-pollination).

So the shape is *"finish and honestly wire what's ~70% built,"* not *"start over."*

---

## The capability stack

The MVP is a line drawn through this stack. v0.2 holds all of #1–#5 (a root-inheritance
version of #5); #6 and #7 ride along partly because the write-back already produces them.

| # | Capability | One-line meaning |
|---|---|---|
| 1 | **Continuing memory** | Experience persists, accumulates, doesn't reset. |
| 2 | **Meaning extraction** | Raw input becomes derived understanding (artifacts). |
| 3 | **Selecting-by-intent** | Recall bent by goals/values/identity — main vs. secondary. *(the heart)* |
| 4 | **The living loop** | Use strengthens, disuse fades (operational signals). |
| 5 | **Identity continuity** | One mind across contexts; a **core/root context with overriding priority**; shared knowledge reaches siblings by **promotion to root**, not a flat pool. |
| 6 | **Inspectability** | You can see *why* it selected and *why* it concluded. |
| 7 | **Associative + provenance** | Links between memories; derivation trails. |

**Architectural commitment (decided, deliberate):** memory is **context-stamped**;
contexts **nest** under a root; recall is per-context; the root has **overriding
priority** and is always consulted as a lens. Cross-pollination happens by **promoting**
a learning to the root (which all contexts inherit) — *not* by a single flat memory pool.
This was a deliberate schema decision, not a default.

---

## Current-state inventory

> **Note (2026-06-27):** this inventory is the **pre-A/B/C snapshot** that motivated the
> build — kept as the diagnosis of record. Since then Buckets A, B, and C shipped, so the
> "🟡 half / starved / dormant" calls on #2 (meaning extraction), #3 (selecting-by-intent),
> and #4 (the living loop) are **now resolved**. #5 (identity) and #7 (associative links)
> remain as written (deferred to v0.2). See the per-bucket status markers below for as-built.

Legend: ✅ built · 🟡 half · 🔵 new build

### #1 Continuing memory — ✅ built
`PrismaMemoryStore` persists entries and embeddings (raw `::vector` write), searches via
pgvector `<->`. Nothing to do.
- `lib/comind/adapters/prismaMemoryStore.ts:111` (create), `:198` (searchSimilar)

### #2 Meaning extraction — 🟡 half
`createReflectionMemory` already creates a derived `MemoryArtifact` **and** writes
provenance (`sourceLinks` → `ArtifactSourceLink`). Derivation + provenance: present.
**Missing:** artifacts are not embedded on creation and not retrieved semantically —
recall only grabs the recent 5 by `accessScore`. So the agent can't *semantically recall
its own past conclusions*.
- `lib/comind/agentRuntime/actions.ts:23`
- Dormant column: `prisma/schema.prisma:285` (`MemoryArtifact.embedding`)

### #3 Selecting-by-intent — 🟢 built but starved
The whole apparatus exists: intention dict (root + current), enhanced matcher with
tag/context boosts, 4-signal rerank (similarity 0.4 / intention 0.3 / importance 0.2 /
recency 0.1). **The store already returns rich entries** (`tags`, `importanceScore`,
`accessScore`…). The starvation is *one layer up*: `searchWithIntention` narrows hits to
`{id, content, timestamp, dist}` before scoring, so the boosts go inert and importance
defaults flat to 0.5. **Turning #3 on is mostly deletion** of that narrowing step.
- Narrowing: `lib/comind/intentions.ts:291`
- Matcher boosts (currently inert): `lib/comind/intentions.ts:146`
- Rerank reads `importanceScore ?? 0.5`: `lib/comind/intentions.ts:225`
- Rich entries already arriving: `lib/comind/adapters/prismaMemoryStore.ts:50`

### #4 The living loop — 🟡 half
`updateRecalledMemoryStats` writes back, but only `importanceScore`, `chatInteractions`,
`lastAccessed`. The machine-native signals the schema indexed — `accessScore`,
`activationCount`, `lastActivatedAt`, `consolidationScore` — are written at defaults and
**never updated, never read by rerank.** The "grows with use / fades without" loop is dormant.
- `lib/comind/agentRuntime/actions.ts:62`
- Indexes waiting to be used: `prisma/schema.prisma:255-257`

### #5 Identity continuity (root-inheritance) — 🟡 partial + 🔵 one new piece
- ✅ **Lens layering exists:** `loadIntentionDict` reads root context + current context,
  so root goals/values/directives already shape scoring everywhere.
  - `lib/comind/intentions.ts:109`
- 🔵 **No overriding priority:** root and local terms merge with `max()`, peers not
  master. "Root overrides" semantics need defining.
- 🔵 **No promotion-to-root:** `createReflectionMemory` stamps every artifact to the
  *current* `contextId`. Nothing elevates a cross-cutting learning to the root, so
  sibling cross-pollination (the farm→house water story) has **no mechanism yet.** This
  is the real new build.

### #6 Inspectability — 🟡 (comes with the runtime extraction)
The decision trace is part of the runtime migration (`runAgent` → `{response, trace}`).
Provenance (the #7 half) already exists via `ArtifactSourceLink`.

### #7 Associative + provenance — 🟡 half
Provenance links: ✅ written by the critic. Associative `MemoryLink` graph: structure
exists in schema, **not yet written or read**. **Deferred out of v0.1 to v0.2 (decided
2026-06-26); structure kept so it's a switch-on later.**

---

## The build, in order

Ordering principle: **un-hollow first (cheapest, highest signal), then wire the loop,
then build the new cross-pollination, then freeze the contract.** Re-run the recall
oracle after every behavior-touching step; a deliberate, reviewed change **re-baselines**
it (the oracle going red on an intended improvement is success, not regression — see
`SchemaIntent_vs_ExtractionDirection.md`).

### Bucket A — Un-hollow #3 *(small / surgical / mostly deletion)*
- Stop narrowing in `searchWithIntention`; carry `tags`, `contextId`, `importanceScore`
  through to the matcher and rerank.
- Result: tag boost + context boost fire; importance becomes real instead of flat 0.5.
- **Gate:** oracle re-baselined on a reviewed diff; the new ranking is the intended one.
- **Risk:** low mechanically, but it's the first *intended* behavior change — review the
  new ordering deliberately.

### Bucket B — Finish the living loop #4 *(medium)*
- Extend the consolidation write-back to update `accessScore`, `activationCount`,
  `lastActivatedAt` (and a consolidation rule for `consolidationScore`).
- Make `rerankWithIntention` read those signals so use actually shapes future recall.
- **Gate:** oracle re-baselined; verify a used memory rises and an ignored one decays.
- **Risk:** medium — this is real new behavior; define the decay/reinforcement rule
  consciously, don't hand-wave the constants.

### Bucket C — The artifact layer (first-class derived meaning) *(largest bucket)* — ✅ DONE 2026-06-27

**Status:** all four pieces built, gated, and committed — P1 `361c1bc`, P2 `7ab79e2`,
P3 `29ed2cb`, P4 `bd4b03b`. Recall oracle re-baselined (an artifact surfaces semantically at
#1 and supersedes its source via prefer-artifact dedup); the artifact-production oracle pins
the write side (typed fields, 1024-dim embedding, source + goal links with id validation);
the activation oracle now covers artifact reinforcement. **No DB migration was needed.** The
piece descriptions below are kept as the as-built record.

**Decision 2026-06-27 (supersedes "leaning defer"):** the artifact layer is **IN v0.1, in
full.** The schema (`MemoryArtifact`, schema.prisma:266) specifies artifacts as first-class
cognitive citizens — their own 7-type vocabulary, embedding, operational signals ("same
logic as memory entry"), goal links, and provenance. Today only a sliver is realized:
`createReflectionMemory` writes a **single hardcoded `INSIGHT`** with no embedding, recalled
only as "recent 5 by accessScore." So there are *two* stacked dormancies — production is
collapsed to one type, and recall of artifacts is non-semantic. v0.1 wires the whole layer
so artifacts ride the **same cognitive pipeline entries already use (A + B)**. Four pieces:

- **P1 — Production (full vocabulary).** Critic emits **0..n typed artifacts per turn**
  across all 7 types (DECISION/INSIGHT/FACT/TASK/QUESTION/CONSTRAINT/SUMMARY), **embedded on
  creation** (populate the dormant `MemoryArtifact.embedding`). Extends the fused
  `agentActionSchema` + prompt.
- **P2 — Semantic recall.** **No DB migration needed** — the `MemoryArtifact.embedding`
  column already exists (migration `20260211051526`). Search artifacts with exact `<->`
  scan, *exactly as entries do today*, and merge them into the same 6-signal rerank.
  **Dedup rule (decided):
  prefer the artifact** — the distilled conclusion takes the slot; its source entries
  collapse under it and stay reachable via provenance (no redundant "conclusion + raw
  source" pairs in the prompt).
  > **Indexing decision (2026-06-27):** no ANN index in v0.1. The entry vector index was an
  > ivfflat that got **dropped** (migration `20251016095622`) and never recreated — entries
  > already run on exact scan, with 100% recall. Exact scan is correct + fast at v0.1 scale
  > and keeps the recall oracle clean (no approximate-recall noise). ANN indexing is a later
  > **perf pass** for real-world scale: **HNSW for *both* tables** (entries and artifacts),
  > not ivfflat (which trains clusters on existing rows → degenerate on a near-empty table).
- **P3 — Living loop for artifacts.** Reuse Bucket B's exact reinforcement rules ("same
  logic as memory entry") — activate artifacts on recall; their `accessScore` /
  `consolidationScore` shape future recall. (Today `dataFetcher` *orders* by accessScore but
  nothing ever *bumps* it — same dormancy B just fixed for entries.)
- **P4 — Goal links / goal-health.** Write `GoalArtifactLink` (strength + rationale). **The
  critic decides** which goals each artifact serves, in the same fused call (Option 1) — the
  schema's `rationale` field wants an *explained* link, not a computed one. Similarity
  backstop (Option 3) is a later, additive refinement if the critic under-links.
- **Gate:** recall oracle re-baselined showing an artifact surfacing semantically + the
  prefer-artifact dedup; a new **critic-path production characterization** (structural —
  types/goal-links valid, since LLM output isn't deterministic); activation test extended to
  artifacts.
- **Risk:** highest behavioral bucket — critic-prompt changes (real LLM-behavior changes the
  recall oracle doesn't cover) and merged artifact/entry ranking. (No DB migration after all.)
- **Order:** before Bucket E (don't freeze the contract until artifacts are first-class).

### Bucket D — Root alignment + promotion #5 *(medium / genuinely new logic)*
- Define **root-priority** scoring (root signals outweigh local — replace the `max()` merge).
- Add a **root-alignment step**: the critic evaluates whether a sub-context's intent or a
  new learning conflicts with root values/constraints, and emits an **alignment signal**
  (`aligned` / `drift` / `conflict` + rationale). The **library** surfaces the signal; the
  **host's** configured policy decides the response — `drive` / `outweigh` / `warn` / `ask`
  / (opt-in) `veto`. No *automatic* veto — surface + human control by default (Shaping
  principle: "AI participates without overriding"). Detection rides on the existing critic.
- Build **promotion-to-root**: a rule in consolidation that elevates a cross-cutting
  learning from a sub-context up to the root, so siblings inherit it.
- **Gate:** demonstrate cross-pollination — a learning made in context X changes behavior
  in sibling context Y, via the root.
- **Risk:** medium — additive on existing structures, but the *decision rule* ("what gets
  promoted, who decides") is a genuine design question (see Open Decisions).

### Bucket E — Extract & freeze the contract *(plumbing)* — ✅ DONE 2026-06-27 (`43dc063`), CORRECTED 2026-06-29

> **Correction (2026-06-29).** The "DONE / runtime routed through injected store" claim
> below was **overstated**. Only the recall *search* leg + the LLM call were actually
> routed; the intention dict, hydration, profile/context/goal/recent reads, and the WHOLE
> write-back still hit Prisma directly, and `createComind` statically imported the Prisma
> adapter (so the barrel leaked Prisma — criterion #2 failed under any non-gamed reading).
> The extraction was genuinely finished 2026-06-29: `MemoryStore` extended with the runtime
> verbs, all reads + write-back routed through the injected store, artifacts embedded via the
> injected `EmbeddingProvider`, and `createComind` made lazy so the barrel pulls zero
> Prisma/OpenAI. Proven by `npm run demo:prove` (real `runAgent` on a non-Prisma in-memory
> store, no DB/keys). All four oracles stayed green. The as-built notes below describe the
> 2026-06-27 partial state.

All five steps landed and gated green (tsc + recall / activation / artifact oracles + adapter
smoke). As-built:
- **Assemblers consolidated** into `lib/comind/contextRecall.ts` (`recallEntriesAndArtifacts`) —
  the shared embed→rerank→hydrate-by-`kind` core behind both `recallForContext` (inspector) and
  `getRecallData` (runtime). Behavior-preserving; recall oracle byte-identical (no re-baseline).
- **`runAgent` → `{response, trace}`** — `DecisionTrace` surfaces recalled entries/artifacts,
  the critic's produced artifacts (with provenance `sourceEntryIds` + goal links), and what was
  activated (#6 inspectability + #10 provenance).
- **Runtime routed through injected `store`/`llm`/`embeddings`** (`RunAgentDeps`); the LLM call
  now goes through the injected `LLMProvider`, waking `llm` from Phase-4 dormancy. Dead
  `lib/llm.ts` removed.
- **Token budget + eviction** — `lib/comind/agentRuntime/tokenBudget.ts` trims the unbounded
  recall blocks (artifacts→entries→recent by priority) before assembly.
- **Public surface frozen** — `index.ts` exposes only the consumer contract (factory + provider
  interfaces + IO types + core/runtime types); no `prisma`/internal leak (criterion #2). The
  parked app's barrel imports were repointed to sub-paths (import-path only, keeps tsc green).
- **Known gap:** the `runAgent` path (incl. trace + budget) is not oracle-covered — it needs the
  LLM (gotcha #4 in the handoff). Pieces are pure assembly verified by tsc + a direct check.
- **Why it was last:** freezing the contract before A–D would have certified the thin runtime as
  the definition — the failure mode `SchemaIntent_vs_ExtractionDirection.md` warns about.

---

## Open design decisions (these block the buckets that depend on them)

1. **Promotion-to-root rule (blocks D).** What makes a learning "cross-cutting" enough to
   elevate? Critic-judged? Threshold on access/recurrence across contexts? Explicit?
2. **Root-alignment semantics (blocks D) — RESOLVED 2026-06-26.** Root is an **active
   aligner**, not a silent dominator. It can **drive** local intent (top-down seeding),
   **outweigh** it (heavier scoring), **warn** on drift, or **ask** the human on conflict;
   *automatic* veto is rejected in favor of surfacing + human control (veto stays opt-in).
   **Boundary:** the library *detects, scores, explains* misalignment (an alignment signal,
   produced by the critic); the host *chooses the policy and presents* any warn/ask.
   **New function introduced:** misalignment *detection* (an evaluative step, rides on the
   critic) — distinct from mere weighting. *Open sub-fork for the v0.1 drill:* "drive"
   (top-down seeding) is separable from "detect + warn/ask" (bottom-up checking); the
   latter is the leaner MVP piece.
3. **Operational-signal math (blocks B).** Concrete reinforcement/decay rules for
   `accessScore` / `consolidationScore` — not just "update them."
4. **Artifact-vs-entry weighting (blocks C) — RESOLVED 2026-06-27.** When a conclusion and
   its source entry both match: **prefer the artifact.** The distilled conclusion wins the
   slot; source entries collapse under it and remain reachable via provenance.
5. **Artifact production shape (blocks C) — RESOLVED 2026-06-27.** Critic emits **multiple
   typed artifacts per turn** (0..n) across the full 7-type vocabulary, not one hardcoded
   INSIGHT.
6. **Artifact→goal linking (blocks C) — RESOLVED 2026-06-27.** **Critic decides** the
   goal(s) each artifact serves + strength + rationale, in the fused call (Option 1). A
   similarity backstop (Option 3) stays a later additive refinement.
7. **Oracle re-baseline policy.** Confirm: each intended improvement re-baselines the
   oracle on a reviewed diff, committed alongside. (Working assumption: yes.)

---

## Relationship to v0.1 (decided 2026-06-26)

**v0.1 = the two PRD cognitive targets + the boundary, app parked.** Mapping to the buckets:

- **In v0.1:** Bucket A (un-hollow #3 → weighting-driven recall) ✅ done, Bucket B (the
  living loop) ✅ done, **Bucket C (the full artifact layer) ✅ done 2026-06-27 (P1–P4)**, and
  **Bucket E (extract + freeze + decision trace) ✅ done 2026-06-27 (`43dc063`)**. All v0.1
  buckets are complete; the reference demo is the remaining proving-ground work (not a bucket).
  Provenance (#2's `ArtifactSourceLink`) is written by the critic; v0.1 surfaces it in the
  `DecisionTrace` (Bucket E) and prefer-artifact dedup uses it (Bucket C).
- **Deferred to v0.2 (structure kept, behavior off):** Bucket D (cross-context identity
  #5) and associative links (#7).
- **The earlier "open scope question" on Bucket C is now CLOSED:** artifacts are in v0.1 in
  full (P1–P4). The schema makes them first-class cognitive citizens, and a meaning layer
  that can't recall its own derived meaning by relevance undercuts the core pitch — see the
  Bucket C section above for the decision and the four pieces.

The personal app is **parked** (frozen in git); the **reference demo** is the proving
ground. `PRD.md` is the v0.1 scope of record.

---

## v0.2 (deferred) — detail

Deferred out of v0.1 but **kept as structure** (tables, columns, core types stay in place),
so v0.2 is a switch-on, not a rebuild. Two workstreams.

### V0.2-A — Cross-context identity #5 (root as active aligner)
Full build detail is **Bucket D** above; summarized here so the v0.2 surface is in one place.
- **What it is.** One mind across many contexts, with a **core/root context that has
  overriding priority** and is always consulted as a lens. Shared learning reaches sibling
  contexts by **promotion to the root** (which all contexts inherit) — *not* a flat memory
  pool. The root is an **active aligner**: it can **drive** local intent (top-down seeding),
  **outweigh** it (heavier scoring), **warn** on drift, or **ask** the human on conflict.
  *Automatic* veto is rejected — surface + human control by default.
- **The three pieces (from Bucket D):** (1) root-priority scoring that replaces the current
  `max()` merge of root+local terms (`intentions.ts:109`); (2) a **misalignment detection**
  step on the critic that emits an alignment signal (`aligned`/`drift`/`conflict` +
  rationale) — the library *detects/scores/explains*, the host *chooses policy & presents*;
  (3) **promotion-to-root** — a consolidation rule that elevates a cross-cutting learning
  from a sub-context up to the root so siblings inherit it.
- **Why it's the real new build, not a wiring job:** today `loadIntentionDict` already layers
  root+current (lens layering exists), but there is **no overriding priority** and **no
  promotion mechanism** — `createReflectionMemory` stamps every artifact to the *current*
  contextId, so sibling cross-pollination has no path.
- **Open decisions that block it:** #1 (promotion-to-root rule — what makes a learning
  "cross-cutting" enough to elevate) and #2 (root-alignment semantics — RESOLVED 2026-06-26;
  see Open Design Decisions). A leaner v0.2 sub-cut: "detect + warn/ask" (bottom-up checking)
  is separable from "drive" (top-down seeding); ship detection first.

### V0.2-B — Associative links #7 (`MemoryLink`)
The associative graph: memories that pull in related memories, with strength and a reason.
- **Schema (present, unused):** `MemoryLink` (schema.prisma:317) — a typed, weighted,
  *explained* edge: `from`/`to`, `type` (default `"related"`), `weight`, `rationale`,
  `attributionType`. Indexed on `(fromId,type)` and `(toId,type)`. **Not written, not read**
  today. (Distinct from `ArtifactSourceLink` provenance, which *is* written — and distinct
  from the artifact layer, which is now in v0.1.)
- **Two capabilities it unlocks:**
  1. **Recall-by-association** — after the intention rerank selects seed memories, traverse
     their links to pull in connected memories (weighted by edge `weight`), so recall isn't
     purely independent top-N by score but can follow the graph — the thing that *feels like
     a mind* rather than a search index.
  2. **The supports/contradicts "validity" angle (consistency checker)** — typed edges like
     `supports` / `contradicts` let the layer flag when a new memory conflicts with an
     existing one, surfacing inconsistency instead of silently storing both.
- **Production:** the critic infers links during consolidation (same fused call), emitting
  `type` + `weight` + `rationale` + `attributionType` (`AGENT_INFERRED`), mirroring how P4
  goal-links work in v0.1 — so the v0.1 critic work is the template.
- **Why deferred:** it's a second graph traversal on top of the recall pipeline and a second
  critic responsibility; v0.1 already takes on typed-artifact production + goal links. Ship
  the artifact layer first, then add link production/traversal with the same machinery.
- **Open question for when it lands:** dedup/merge between association-pulled memories and
  score-ranked ones (analogous to the prefer-artifact dedup decided for v0.1).
