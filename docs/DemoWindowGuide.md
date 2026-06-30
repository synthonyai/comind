# Reading the CoMind Demo Window

A mechanics-only guide to what's on screen when you run the reference demo — what
each region is, what every symbol means, and how the state changes across the run.
This describes the **robot-detective scenario** (`The Dockside Case`).

## How to run it

```bash
npm run demo:play   # Rung 1 — scrolling transcript (a fresh block per turn)
npm run demo:tui    # Rung 2 — persistent split-pane, auto-advances on a timer
npm run demo:step   # Rung 2, but YOU advance: space/enter → next turn, q → quit
npm run demo:repl   # Rung 3 — interactive REPL, drive the case live
```

The same underlying `DecisionTrace` drives all of them; only the surface differs.
The `▲/▼` movement arrows and the live re-rank are easiest to see in the split-pane
— and **`demo:step`** is the best way to catch them: it parks on each frame until
you press a key, so you can sit on the Dispatch 2 → 3 boundary and diff the right
panel yourself instead of racing the 1400ms timer.

## The frame (Rung 2 / TUI)

```
┌──────────────────────────────────────────────────────────────┐
│  The Dockside Case  —  THE MIND, live          ← title bar    │
│  directives: …                                                │
├──────────────────────────────┬───────────────────────────────┤
│  CASE FEED (left)            │  THE MIND (right)              │
│  what's said / observed,     │  the live mind-state,          │
│  scrolls down                │  redrawn in place each turn    │
├──────────────────────────────┴───────────────────────────────┤
│  recalled N memories · ~X tokens injected · dispatch: …       │
└──────────────────────────────────────────────────────────────┘
```

- **Left column — the case feed.** Everything said or observed, accumulating and
  scrolling. Long lines now **word-wrap** to fit the column.
- **Right column — THE MIND.** The whole mind-state, rebuilt from the turn's trace.
- **Top bar** — context title + standing directives.
- **Bottom bar** — the cost line (how little gets injected; see below).

## Dispatches = sessions

A **dispatch is one session.** A `💤` banner marks the boundary. Between dispatches
the conversation window is wiped — Dispatches 2 and 3 literally **boot cold**
(`[dispatch reset — booted cold]`). The chat scrollback is gone; the mind on the
right persists. That contrast is the point.

The scenario has **3 dispatches**:

| Dispatch | Focus | What happens |
|---|---|---|
| 1 — first sweep | — | Records 3 observations; distills each into a typed artifact citing its clue. |
| 2 — cold boot | WHO | `culprit` goal active → "suspect/cargo" boosts the butler FACT to the top; forms the DECISION. |
| 3 — cold boot | HOW | `culprit` goal **completes** → its terms drop from the lens → the *same* memory pile re-ranks; the method QUESTION rises, the suspect sinks. |

## The standing core vs. the shifting focus (top of the mind panel)

- `★ north-star` (`seedIntent`) and `◇ values` — **given upfront, fixed forever.**
  They never move across resets. Shown every turn on purpose so you can watch them
  hold still.
- `▸ focus` — the **active goals**. This is what changes, and it changes via **goal
  lifecycle** (a goal completing), *not* by what you type.

## How recall relates to Dispatch 1 / 2 / 3

The recalled list is the **same memory pile, re-ranked by the current focus.** The
re-rank is engineered to land at the **Dispatch 2 → Dispatch 3 boundary**:

- **D1** — memories are *recorded* (you see `✎ produced` lines; little recall yet).
- **D2** — focus = `culprit` (weight 0.9). Its vocabulary ("suspect/cargo") boosts
  the butler FACT to the **top** of recall.
- **D3** — the scenario completes the `culprit` goal. "suspect/cargo" leaves the
  lens, `method` now leads, and the **same pile re-ranks**: the method QUESTION
  rises, the suspect FACT/DECISION sink. The identity core never moves.

> If recall looks static, you're probably looking *within* a single dispatch (it
> only moves at the D2→D3 goal completion) or running the Rung 1 transcript, where
> each turn prints a fresh block. The `▲/▼` arrows exist only in the TUI.

## The symbols

### Left-margin delta marks (TUI only — score vs. last turn)
| Mark | Meaning |
|---|---|
| `▲` (green) | intention score **rose** |
| `▼` (red) | intention score **fell** |
| `·` (dim) | steady |
| `＋` (cyan) | **new** this turn (wasn't recalled before) |

### Item-type bullets
| Symbol | Meaning |
|---|---|
| `◆ [TYPE]` | an **artifact** — a derived conclusion (FACT / QUESTION / CONSTRAINT / DECISION / TASK). Listed first. |
| `●` | a **raw entry** — an original observation. |

### Per-item second line — `intent ▰▰▰▰▱ 0.82 · conf ▰▰▱▱▱ 0.50 · told`
| Field | Meaning |
|---|---|
| `intent` + bar | **intention score** — the re-rank weight; what the `▲/▼` arrows track. |
| `conf` + bar | **confidence** — how sure the mind is. The `▰/▱` draws a 0–1 score as 5 cells. |
| `told` / `inferred` | **attribution** — `inferred` = the mind figured it out (all artifacts are inferred); `told` = came from outside (a user/system input). |
| `◷ open` | appears on QUESTION/TASK only — an **open commitment** the mind carries forward. |

### Below the recall list
| Line | Meaning |
|---|---|
| `✎ produced [TYPE] … ⇐ N clue(s)` | what the **memory critic created** this turn. `⇐` is **provenance** (how many source entries it cites). `· goal×N` = goals it links to. |
| `↻ reinforced N entr · M artifact` | the **living loop** — which memories got reinforced this turn. Those items are **bolded** in the list above. |
| `↳ "…"` | the agent's **response** for the turn. |

### Bottom cost line
`recalled N memories · ~X tokens injected (est.) · dispatch: …` — the point being
that only a handful of *selected* memories get injected, not the whole history. The
token figure is a rough estimate (chars ÷ 4) of the previews actually injected.

## The one moment to watch

Run `npm run demo:tui` and watch the right panel at the **Dispatch 2 → Dispatch 3
boundary** — that's the single point where the bars and `▲/▼` actually move, driven
by the `culprit` goal completing while the north-star and values hold steady.
