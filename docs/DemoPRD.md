# CoMind Reference Demo — PRD

*Drafted 2026-06-29, from the demo design conversation. Companion to `docs/PRD.md`
(the v0.1 product PRD). This doc scopes the **reference demo** — PRD item 7 and the
"proving ground" the build map calls for — now that the v0.1 extraction is finished
and proven (the in-memory store + `npm run demo:prove`).*

---

## Why this demo exists

CoMind's whole differentiation is **invisible**. A vector store and CoMind both "return
some text." The value is in the *why* (selection by intent), the *change over time*
(the living loop), the *derived meaning* (artifacts), and the *paper trail* (provenance).
A demo's job is therefore singular: **make the invisible visible**, and do it in a way a
non-expert grasps in seconds.

It has two audiences and two jobs:

1. **Prove the boundary holds** — a developer can embed CoMind by implementing the three
   interfaces, with no Prisma/Next/OpenAI lock-in (PRD success criteria #1, #2, #6).
   *This job is already done* — see "Foundation (already built)".
2. **Show what CoMind actually does** — not just "remembers the direction you set," but
   the full v0.1 capability surface, dramatized so the difference from a plain LLM is
   visceral, not asserted.

This PRD is mostly about job #2.

---

## What the demo must make a person believe

The demo may only dramatize capabilities that are **actually wired in v0.1**. Promising
deferred ones would be the same "gameable proxy" failure the project just corrected.

These 14 claims are what a viewer should walk away convinced of. They were derived in
plain English, then **drilled against `prisma/schema.prisma` as the design intent** — so
each one names the schema structure that makes it real, and the grouping into themes is
itself a claim about how the demo is structured. (Items 10–14 were added *because the
schema intends them* and the first cut had missed them.)

**The continuous, weighted core**
1. **Priority memory stays priority** — what mattered most still drives behavior 40 moves
   later; recency doesn't bury it. *(schema: `Goal.weight`, `MemoryEntry.importanceScore`)*
2. **Memory is continuous, and weight makes it durable** — it carries across
   sessions/resets; the heavier it's weighted, the longer it survives. *(schema: the
   operational signals `accessScore`/`consolidationScore`/`lastActivatedAt`/`activationCount`)*

**Making meaning**
3. **The mind makes meaning, not just a record** — raw "stepped on lava at 4" becomes a
   distilled "CONSTRAINT: never step on 4." The conclusion reads nothing like the input.
   *(schema: `MemoryArtifact` + its 7-type vocab)*
12. **It carries open questions and to-dos forward, not just settled facts** — it also
    forms `QUESTION`s it's still chewing on and `TASK`s it owes, and those persist until
    resolved. *(schema: artifact types include `QUESTION` and `TASK`, not just
    `DECISION`/`FACT`/`CONSTRAINT`)*
11. **It holds beliefs with a confidence level — it can be unsure** — a hard fact sits
    high, a hunch low, and the difference is visible. *(schema: `confidence` on both
    entries and artifacts)*
10. **It knows what it was *told* vs. what it *figured out itself*** — every
    memory/conclusion is tagged "you said this" vs. "I inferred this"; it never blurs the
    two. *(schema: `AttributionType`, threaded through entries, artifact-source links, and
    goal links)*

**Selecting by intent (the heart)**
13. **What it attends to is a standing identity, not a goal dial** — the lens is the
    mind's whole self (directives, watch-words, values, constraints, direction); goals are
    one input. *(schema: intent composed from `AgentProfile` directives/watchWords +
    `Context` values/constraints/direction + weighted `Goal`s)*
4. **It picks what to remember based on what it's trying to do now** — same situation,
   different intent in focus → different memories surface. *(schema: the intention re-rank
   over `AgentProfile`/`Context`/`Goal`)*
14. *(optional)* **Priorities have a lifecycle** — a completed or paused goal stops
    pulling focus; attention shifts to what's still active. *(schema: `Goal.status`
    ACTIVE/COMPLETED/PAUSED/ARCHIVED + `order` + hierarchy)*

**The living loop**
5. **Memory reorganizes by use** — leaned-on memory strengthens and rises; ignored memory
   fades. A ranking that moves, not a flat pile. *(schema: the operational signals **and
   their indexes** — designed to be ranked on at read time)*
6. **It recalls its own conclusions, and the raw stuff steps aside** — it remembers the
   *lesson*, not the ten messy events; the source collapses under the conclusion
   (prefer-artifact). *(schema: `ArtifactSourceLink`; artifacts carry their own
   embedding + signals)*

**Showing its work**
7. **It can show its receipts (provenance)** — "I decided X, and here's the exact
   observation that made me." *(schema: `ArtifactSourceLink.rationale`,
   `GoalArtifactLink.rationale`, `AttributionType`)*
8. **You can open the mind and see why it acted** — the whole decision is inspectable, not
   a black box. *(realized by the `DecisionTrace`; what there is to inspect is the schema's
   rich signals + links)*

**The cost story**
9. **It doesn't hoard** — a handful of selected memories per move, not the whole history
   re-dumped. Cheaper, faster, sharper. *(enabled by the scoring fields + a runtime token
   budget)*

**One-line reframe tying it together: a managed mind vs. a growing pile.**

### The headline vs. look-inside sort

The "with vs. without CoMind" contrast carries only a few of these (the visceral ones);
the rest are shown by *inspecting the CoMind run* (the boxes / the trace), not by contrast
with a dumb agent. The sort below assigns each claim. *(The concrete examples are written
in the corridor/robot framing that was current when the sort was made; the framing is
under reconsideration — the assignment of claim → bucket is what's durable, not the props.)*

**Headline — the contrast carries it.** Inside Headline, what carries it matters: *robot
outcome* tells the world what to make happen; *box-glance* / *meter* tell the renderer what
to expose.

| # | Claim | What carries it | Frontier-proof? |
|---|---|---|---|
| 2 | Continuous + weight = durable | **outcome** — after a reset, CoMind keeps the map, the plain side dumps to last-K and re-steps | ✅ per-session reset |
| 1 | Priority stays priority | **outcome** — an early constraint acted on much later, after lots of noise; the plain side forgot it | ✅ persistence + selection |
| 6 | Recalls the lesson, raw steps aside | **outcome + box** — CoMind acts instantly on one distilled conclusion; the plain side re-derives from raw and wavers | ✅ distilled meaning |
| 9 | Doesn't hoard | **the token meter** — a handful of tokens vs. thousands, even on turns where both act the same | ✅ cost-of-hoarding |
| 3 | Makes meaning (typed) | **box-glance** — left box: a typed `CONSTRAINT`; right box: a scrolling raw log | (rides on 2/6) |

**Look-inside — inspect the CoMind run; the plain agent can't partner it.**

| # | Claim | How it shows | Note |
|---|---|---|---|
| 4 + 13 | Selecting by intent / standing identity | recall re-ranks when intent shifts; the box shows the directives/values lens | **the heart — but inspect-only** |
| 7 | Provenance | "did X ⇐ the exact memory that caused it" | **the bridge** (see below) |
| 5 | Living loop reorganizes by use | score-bars rise/fall across turns | a ranking that *moves* |
| 8 | Inspectability | the `DecisionTrace` itself | this *is* the look-inside medium |
| 10 | Told vs. inferred | colored attribution tags in the box | box-detail |
| 11 | Confidence | a number/bar per memory | box-detail |
| 12 | Open questions / to-dos | a `QUESTION`/`TASK` the box is tracking | box-detail |
| 14 | Goal lifecycle | a goal flips COMPLETED → recall re-weights | optional |

**What the sort surfaces (the design payoff):**

1. **The headline is thin — and that's correct.** It rides on exactly the three
   frontier-proof differentiators (persistence-across-reset #2, cost-of-hoarding #9,
   distilled-lesson #6/#3). The sort *confirms* the frontier-proofing; don't promote more
   claims into the headline — it gets weaker, not stronger.
2. **The heart of the pitch is NOT a headline item.** Selecting-by-intent (#4/#13) has
   **no contrast partner** — the plain agent has no intent lens to lose, so it can only be
   *shown*, not *contrasted*. Consequence: the demo must **earn attention with the headline
   (persistence/cost), then spend it on the look-inside reveal** where the real thesis
   lives. The look-inside is the argument, not garnish.
3. **Provenance (#7) is the bridge.** Success criterion #1 ("point at the memory that
   caused each smart move") is provenance *used to explain the headline outcome*. So #7 is
   look-inside content **promoted into the headline moment as the explanation**: whenever
   the CoMind agent makes a smart move, the box flashes the source memory — fusing outcome
   (headline) + provenance (#7) + typed meaning (#3) in one beat. Highest-leverage
   rendering decision in the demo.

Structural implication: the plain agent only partners the four "forgetting" claims
(1, 2, 6, 9). Everything else has no dumb-agent counterpart — so the bulk of the demo is
the CoMind run's own richness. **The contrast is the hook; the inspection is the substance.**

> **Out of bounds (v0.2 — do NOT depict):** associative links (`MemoryLink`, "memories
> pulling in related memories") and cross-context identity / promotion (`Context.parent`,
> `AgentContext`, cross-context cross-pollination). Also out: org/multi-user models and
> `MemoryEntry.derivedFrom` entry→entry chains (present in schema, not wired in v0.1).

---

## The core design — a robot detective's mind, shown literally

**Form (decided): a CLI / terminal program** — turn-based, run from a single command. Not
a web app, not a 2-D game, not real-time. **One** mind is shown — the CoMind run itself —
**not** a side-by-side race against a plain agent (the contrast is dropped from v1; see
"Out of scope" and the reset mechanic for why the single run still carries the story).

**Scenario (decided): a robot detective working a case across "dispatches."** The robot
investigates — gathering clues (raw `MemoryEntry` observations), distilling them into typed
conclusions (`FACT`, `QUESTION`, `DECISION`, `CONSTRAINT`, `TASK`), and — crucially —
**recalling its own deductions later, with the raw clues collapsing under the conclusion.**
Detection was chosen because the two deepest, hardest-to-show claims — provenance ("I
concluded X ⇐ these exact clues", #7) and recall-the-conclusion-not-the-events (#6) — are
*the genre itself*, not features bolted on. The robot framing keeps the charm; the body is
near-zero (narrated observations, no grid, no movement).

**Display: a split-window literal mind-display.** Left = the case feed (what the detective
observes / what you tell it). Right = the **live mind panel**, rendering the `DecisionTrace`
each turn: the standing identity (directives / values / weighted goals), the ranked recalled
memories with intention score-bars, the produced artifact with its provenance ⇐, confidence,
and told-vs-inferred tag, the living-loop deltas, and the response. The spotlight stays on
the **mind**: every deduction is traceable to a clue visible in the panel.

```
  ┌─ CASE FEED ────────────────┐   ┌─ THE MIND (CoMind) ────────────────────┐
  │ > witness: the butler was  │   │ identity: "Detective" · values: rigor   │
  │   at the dock at 9pm       │   │ goals:  ▸ identify the culprit  (w .9)  │
  │                            │   │ recalled (ranked):                       │
  │ > [dispatch 2 — rebooted]  │   │   ● "butler@dock 9pm"   intent .82 ▲ told│
  │ > who do we suspect?       │   │   ◆ DECISION: suspect = the butler  .78  │
  │                            │   │       ⇐ clue#3, clue#7 · goal▸culprit   │
  │                            │   │   ? QUESTION: who held the cellar key?   │
  └────────────────────────────┘   └──────────────────────────────────────────┘
   [ recalled 3 memories · 210 tokens injected this turn ]
```

The panel **grows** as the case develops — clues stack, conclusions form, scores
consolidate — and after a dispatch reset it may look *sharper*, not emptier. You watch a
mind accumulate, organize, and persist.

**First cut = a scrolling transcript that re-prints the evolving mind-state each turn** —
no TUI, no interactivity, no second agent. It's `proveBoundary.ts` upgraded from assertions
to narrated, pretty-printed rendering. A persistent split-pane TUI panel (Ink/blessed) and
an interactive REPL are *additive polish on the same engine*, not prerequisites (see the
build ladder).

---

## The hard part: making the difference real (the traps)

These are the design constraints that separate an honest demo from a rigged one.

### Trap 1 — the case must be *memory-shaped*, not *puzzle-shaped*

If the case is solvable by reasoning over what's on screen *right now*, it tests deduction,
not memory — and a frontier LLM does that trivially. The payoff must be gated by
**remembering across the dispatch resets**, so the trace visibly leans on *recalled* memory:

- Clues are **discovered, then must be remembered** ("butler at the dock at 9pm"). The mind
  forms a `FACT` and recalls it dispatches later, after the raw conversation is gone.
- A rule given **once, early** ("the cellar key never leaves the housekeeper") matters at
  the reveal. The mind recalls it; nothing on the current screen would supply it.
- **The focus shifts** mid-case (from *who?* to *how?*) and **recall re-weights** with it —
  the same clue pile surfaces different memories under the new intent (#4/#13).

The "smart" recalls must be **genuinely earned** by what's in the store — never staged. The
test: blank the memory panel and the deduction should become impossible. If the model could
get there from the visible turn alone, that beat isn't proving memory.

### Trap 2 — the fair contrast is *deferred*, not faked

The original design raced CoMind against a plain agent with a bounded sliding-window log.
**That contrast is dropped from v1** — it's body cost that exercises no cognition, and the
inspector's job is *clarity about how the mind works*, not beating a baseline. When the
contrast returns (in the later "gasp" cut), the rule still holds: pick the **honest**
competitor (a real context-stuffing or vector-store baseline), never a crippled window
tuned to lose.

### Trap 3 — it must survive a *frontier* LLM with a huge context window

"Forgets within one session" does **not** hold against a 200k-token model. So the demo only
showcases claims that survive *any* context size — which is why even a single-run inspector
is honest:

1. **The window is per-session.** Context resets at each dispatch; memory has to live
   *outside* the conversation. This carries most of the drama (see the reset mechanic).
2. **Hoarding is expensive and dilutes.** Even when everything "fits," dumping the full
   history every turn is slow, costly, and buries the needle ("lost in the middle"). The
   panel shows CoMind injecting ~3–8 *selected* memories with a token count, not a dump.
3. **A pile of history isn't distilled meaning.** A raw transcript re-derives its
   conclusions every turn (and can waver); CoMind holds stable, typed, provenance-tracked
   artifacts.

### The reframe

The pitch is **not** "remembers vs. forgets" — it's **"a managed mind vs. a growing pile."**
The demo shows the *managed mind* directly: a thing that organizes, prioritizes, distills,
and persists, instead of accumulating raw text until it's expensive, slow, and bounded.

---

## The reset mechanic (how we compress "many sessions" into a short demo)

In real agent systems **each step is already a stateless call** — the orchestrator
re-assembles a prompt every invocation and decides what state to pass. So "reset the context
between dispatches" isn't a trick; it's just *what an agent is*, and it poses the real
question: **what carries state across calls?** CoMind is the answer.

- Reset cadence: **every few observations = a new "dispatch."** A few turns let the mind do
  fine *within* a session; the reset is where the difference between "held in context" and
  "held in CoMind" becomes visible. The effect accumulates over several short dispatches in
  short wall time.
- Give the reset a **reason in the fiction** (the robot detective files its report and
  powers down between dispatches; each dispatch is a fresh boot) so it's part of the world,
  not an asterisk.
- On reset: a visible "💤 dispatch reset" beat. The conversation/context is **gone**; the
  CoMind panel **keeps everything** — and the operational signals may make it *sharper*
  (consolidated), not just intact.
- Dramatization: **Dispatch 1** — gather clues, form tentative `FACT`s and an open
  `QUESTION`. Reset. **Dispatch 2** — boot cold and ask "who do we suspect?"; the mind
  recalls "suspect = the butler ⇐ clue#3, clue#7" **without re-seeing the clues**. Dispatch 1
  builds the case; Dispatch 2 is the payoff — memory the conversation can no longer supply.

---

## Build ladder (presentation only; the core is shared)

The substance — in-memory store + the scenario harness + reset mechanic — is identical at
every rung. Only the *presentation* changes, and that's where the effort variance lives.
Higher rungs are additive on the same engine.

| Rung | What | Status |
|---|---|---|
| **1. Scripted transcript (the first cut)** | fixed case inputs across dispatches; per turn, pretty-print the evolving mind-state from the `DecisionTrace` + token count | **BUILT 2026-06-29** (`npm run demo:play`) |
| **2. Persistent TUI panel** | the literal split-window (chalk+ANSI redraw, *not* Ink/blessed): identity + ranked memory table w/ score-bars, rerank x-ray (▲/▼), living-loop deltas re-rendered in place | **BUILT 2026-06-30** (`npm run demo:tui`) |
| **3. Interactive REPL** | you type observations / questions and drive the case live (`/clue`, `/ask`, `/reset`, `/goal`) | **BUILT 2026-06-30** (`npm run demo:repl`) |
| 4. Plain-agent contrast | an honest baseline panel for the "60-second gasp" cut | later |
| 5. Web skin | the same engine, rendered in the parked Next.js app's drawer style | later, optional |

**Decision: the first cut is Rung 1 — a scripted transcript that richly renders the mind
each turn.** It's the leanest thing that makes the 14 claims visible, it *is* the
development test-ground (real scenarios through real cognition, watching the trace), and
everything above it (TUI, interactivity, contrast, web) is pure presentation on an unchanged
engine. The 60-second layperson "gasp" demo is a **later, separate deliverable** built on
this engine — this cheaper demo proves the substance first and becomes the ground we tune it
on.

---

## Foundation (already built and proven, 2026-06-29)

The "shared core" the demo stands on exists and is verified:

- **`demo/inMemoryStore.ts`** — a pure-TS `MemoryStore` (cosine similarity, no SQL), the
  proof that a non-Prisma backend can implement the contract.
- **`demo/proveBoundary.ts`** (`npm run demo:prove`) — runs the **real `runAgent`**
  end-to-end on the in-memory store with **no DB and no API keys**, asserting recall →
  typed-artifact production with provenance + goal link → living-loop activation →
  second-turn recall of the derived artifact → **zero Prisma/OpenAI loaded**.
- The v0.1 extraction is genuinely complete: the `MemoryStore` interface, store-routed
  reads + write-back, and a lazy `createComind` that keeps the barrel clean.

So the game does **not** need new cognition — it needs a **host** (the game world +
two-agent harness + renderer) on top of a finished library. The `DecisionTrace` already
carries everything the boxes need to render.

---

## Dependencies

Default to **real providers with a stub fallback**: real embeddings (HuggingFace) + real
LLM make derivation and recall genuinely convincing; an `--offline` flag swaps in the
deterministic stubs (`proveBoundary.ts` already has both) for no-key, reproducible runs.
The visualization is only as honest as the embeddings under it, so the showcase run wants
real ones; CI / portability wants the stubs.

---

## Success criteria

1. A non-expert watching for 60 seconds can say *why* the CoMind robot wins — and point
   at the memory in its box that caused each smart move.
2. The plain robot's failures are **emergent and fair** (a fact aged out of a fixed,
   visible window), never scripted.
3. The demo holds up against a frontier LLM: it leans on persistence-across-sessions,
   cost-of-hoarding, and selection-under-load — not "forgets within a session."
4. Every depicted behavior maps to a v0.1 capability (no `MemoryLink` / cross-context
   features implied).
5. Runs from a single command; the showcase path uses real providers, `--offline` uses
   stubs and needs no keys/DB.

---

## Out of scope

- Associative-link or cross-context-identity behavior (v0.2) — not depicted.
- A polished web/3D frontend (Rung 4) for the first cut.
- Real-time play (turn-based is the v1).
- Multi-user, hosted, or production concerns.

---

## Status (2026-06-29)

**Rung 1 is built and runs green offline** (`npm run demo:play -- --offline`) — the
scripted-transcript engine + the `DecisionTrace` mind-panel renderer + the dispatch-reset
mechanic, on the proven in-memory store. The Dockside Case now runs **three dispatches** and
covers claims **#3 (typed meaning), #6 (recall the lesson / raw steps aside), #7 (provenance),
#9 (token cost)**, the **persistence-across-reset** headline, the **focus-shift re-rank
(#4/#13, the heart), driven by goal lifecycle (#14)**, and — added 2026-06-29 (later) — the
three **belief-signal** look-inside claims: **#10 told-vs-inferred, #11 confidence, #12 open
questions/to-dos carried forward**.

**The belief-signal beat (#10/#11/#12) — the first library change since the scaffold.** It was
purely a *surfacing* job: the data was already in the schema and already authored in the
scenario (every observation `record` is `attribution: USER_EXPLICIT`; every artifact carries a
deliberate `confidence` — a 0.5 QUESTION hunch up to a 0.9 CONSTRAINT). The `DecisionTrace`
just wasn't carrying it. Three additive, non-breaking library changes threaded it through:
`DecisionTrace.recalled.entries` gained `confidence` + `attribution` (the real `AttributionType`
enum — schema-faithful; the renderer collapses to the told/inferred binary), `.artifacts` gained
`confidence` (no `attribution`: `MemoryArtifact` has no `attributionType` column because a derived
artifact *is* the "figured-out-itself" side by construction), and `AgentContextData` +
`formatMemoryEntry` pass the already-hydrated fields through. The renderer now prints a per-item
line — `intent … · conf … · told|inferred` — and an `◷ open` flag on QUESTION/TASK. So the panel
visibly contrasts raw **told** observations against the mind's **inferred** conclusions, shows how
sure it is per belief, and marks the commitments it carries forward. All four oracles + `demo:prove`
+ tsc stayed green (the additive trace fields break no assertions).

**The focus-shift beat (Dispatch 3 — #4/#13/#14).** Once the suspect is named, the host
completes the `culprit` goal (`updateGoal(..., { status: 'COMPLETED' })`); its terms
(suspect/cargo) leave the ACTIVE intention lens and the `method` goal leads. A **focus-neutral**
prompt ("what should we chase next?") then re-ranks the *same memory pile*: the method QUESTION
rises to the top and the suspect FACT's intention score visibly drops (1.00 → 0.40), proving the
re-rank is the **lens's** doing, not the query's. The renderer prints the standing lens every
turn, so the **persistent core (north-star + values) is visibly fixed** across all three
dispatches while only the focus line shifts — the "standing identity, not a goal dial" claim made
literal. Three design decisions made this honest:

1. **One additive contract verb: `MemoryStore.updateGoal(id, GoalPatch)`** (goal lifecycle —
   status/weight/title/order). Implemented in both adapters. Deliberately **no `updateContext` /
   `updateAgentProfile`**: the standing identity is the *persistent core* and is **immutable in
   v0.1 by construction** — the absence of a setter is the guarantee that the core sticks.
   Identity evolution is the v0.2 governed root-aligner path (Bucket D), never a raw setter.
   (Rationale: contract-surface changes are cheapest *now*, before external consumers — so the
   goal-mutation surface was frozen once, deliberately.)
2. **`DecisionTrace.lens`** (additive, non-breaking) — surfaces the standing lens the runtime
   actually weighted on (seedIntent/values/directives/watchWords + active goals), from data the
   prompt already fetched. This is what makes the persistent-core/shifting-focus contrast visible
   (#8 inspectability + #13).
3. **Neutral persistent core.** The seedIntent/values/watchWords are kept neutral between
   who/how; the who/how vocabulary lives in the two *goals* (`culprit` ↔ suspect/cargo, `method`
   ↔ crate/dock). Otherwise a who-biased north-star would keep pulling toward the suspect after
   the culprit goal closed, muting the shift.

The first authoring pass earlier surfaced — and fixed — a Trap-1 violation (a Dispatch-2 claim
recall didn't back) by storing observations as entries and authoring provenance explicitly; the
Dispatch-3 prompt is held neutral for the same reason (so the lens, not the query, does the work).

**Real-provider credibility check — DONE 2026-06-29, PASSED.** Ran `npm run demo:play` (no
`--offline`) against live HuggingFace `BAAI/bge-large` embeddings + OpenAI, to confirm the
focus-shift re-rank lands on *meaning*, not the stub embedder's word-overlap. **It holds:** the
WHO-relevant `butler @ dock` memory drops 0.94 → 0.40 when the `culprit` goal completes and the
lens shifts to `method`, while the HOW-relevant `crate left the dock` memory stays high (1.00 →
0.90). That directional delta — the same memory pile re-ranked by the lens alone (#4/#13) — is
genuine under real embeddings, not a scripted/stub artifact. Persistence also held (Dispatch 2
booted cold and recalled the suspect + key-rule purely from stored artifacts). **Three honest
wrinkles, all expected for a live model** (and exactly why offline stays the reproducible demo):
(1) the real LLM produces more + different artifacts (an extra INSIGHT, more FACT/TASK/QUESTIONs),
so the pile grows to 8 by D3 and the clean scripted beats blur; (2) confidence clusters high
(~0.80–0.95) — the crisp 0.5-hunch/0.9-hard-rule spread is a scripted feature the model doesn't
reproduce; (3) told-vs-inferred contrast lives in Dispatch 1 — by D2/D3, prefer-artifact dedup has
superseded the raw "told" entries, so everything shown is "inferred."

**Rung 2 (the persistent TUI panel) — BUILT 2026-06-30.** `npm run demo:tui` (or `demo:play --
--tui`); `--pace <ms>` sets the per-turn dwell (default 1400; `0` = instant for capture). Drawn
with **chalk + a full-frame ANSI redraw**, *not* Ink/blessed — Ink is ESM-only and fights the
CommonJS ts-node runner, while chalk was already installed and is CommonJS-safe (zero integration
risk). `demo/panel.ts` is a stateful split-pane (left = scrolling case feed, right = the live mind
redrawn in place); it reuses the pure trace→signal helpers now exported from `render.ts`
(`bar`/`f2`/`attrTag`/`isOpen`). What it adds over the transcript: the panel is *persistent*, so
re-ranking reads as **movement** — each recalled item shows a **▲/▼ rerank delta vs. last turn**
(the #4/#13 focus-shift made visible — the butler FACT shows ▼ and drops to 0.40 when the culprit
goal closes in Dispatch 3), and living-loop reinforcement (#5) **bolds** the touched items. No
`lib/comind` change (only `demo/` + `package.json`), so the boundary is untouched; `demo:prove` +
the Rung-1 transcript + `tsc` all stayed green.

**Rung 3 (the interactive REPL) — BUILT 2026-06-30.** `npm run demo:repl` (add `--tui` to drive the
Rung 2 split-pane, `--offline` for no-key recall-only). Where Rung 1/2 *replay* the scripted case,
Rung 3 hands the operator the prompt and lets them drive one live: `/clue <text>` records an
observation (a `told` entry) then deduces from it, bare text or `/ask` recalls without recording,
`/reset` triggers the dispatch cold-boot **on demand** (drop the chat window; the store persists), and
`/goal <key> done|pause|active|w<n>` drives goal lifecycle live so the operator can watch the *same*
memory pile re-rank beneath the unchanged identity core (#4/#13/#14). This is the rung that makes the
recalls **un-stageable**: the operator picks the questions, so a surfaced memory is earned, not
scripted — directly serving Trap 1. No `lib/comind` change (only `demo/` + `package.json`): a shared
`demo/seedWorld.ts` was extracted from `play.ts` so both drivers prove the *same* seeded world (any
difference is in driving, not setup), and the REPL reuses the Rung 1 transcript renderer / Rung 2
panel verbatim. `demo:prove` + Rung 1 + Rung 2 + tsc all stayed green after the extraction.

*Honest `--offline` caveat:* derivation (arbitrary raw clue → typed artifact) needs a real LLM to read
free-form operator input; the deterministic stub can't, so offline is a deliberately **recall-only**
REPL — recall, persistence-across-`/reset`, and the goal-driven re-rank are all real, but it mints no
new conclusions. The full loop (typed artifacts with provenance from whatever you type) runs without
`--offline`.

**Next:** Rung 4 (the plain-agent contrast / the "60-second gasp" cut) or Rung 5 (web skin). The
look-inside claim surface is complete for v0.1 — #4/#13 (proven under real embeddings), #10, #11, #12,
plus the headline #3/#6/#7/#9 + persistence — and all three presentation rungs (transcript, TUI, live
REPL) now ride the same unchanged engine. Everything that remains is *presentation* or the honest
baseline contrast, not new cognition.

## Open questions

1. **Warm-up — RESOLVED.** Did Rung 1 (scripted transcript) first as the credibility check /
   dev test-ground; it's built. The interactive REPL (Rung 3) and TUI (Rung 2) ride on the
   same engine when wanted.
2. **Scenario domain** — household-assistant ("mind in a body") vs. a more
   developer-familiar project/coding agent. The capability arc is identical; only the
   surface story differs.
3. **Mini-session shape** — exact reset cadence (every N moves), window size K for the
   plain baseline, and how priorities shift mid-run. (Deferred from the design talk;
   settle when building.)
4. **Plain-baseline transparency** — show the plain side's raw growing prompt verbatim
   (maximally honest, possibly noisy) vs. a summarized "this is what it's juggling" panel?
