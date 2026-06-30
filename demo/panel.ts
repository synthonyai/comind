/**
 * Rung 2 surface — the persistent split-window TUI (the PRD's "literal
 * mind-display"). Same `DecisionTrace`, different surface: where Rung 1 scrolls a
 * fresh block per turn, Rung 2 keeps ONE frame and redraws it in place each turn —
 * left = the scrolling case feed, right = the live mind panel. You watch the mind
 * accumulate, re-rank, and persist rather than reading a log of it.
 *
 * No TUI framework: a full-frame ANSI redraw + `chalk`, which is CommonJS-safe and
 * fights neither the ts-node runner nor React 19. The pure trace→signal helpers
 * are shared with the transcript renderer (`render.ts`) — single source of truth
 * for bars / attribution / token math.
 *
 * What Rung 2 adds over the transcript:
 *  - the panel is PERSISTENT (redrawn in place), so re-ranking reads as movement;
 *  - each recalled item shows a rerank delta (▲/▼) vs. its score last turn — the
 *    #4/#13 focus-shift made visible as the bars actually move;
 *  - the living-loop reinforcement (#5) is highlighted on the items it touched.
 */

import chalk from "chalk";
import type { DecisionTrace } from "@/lib/comind";
import { bar, f2, attrTag, isOpen, estimateInjectedTokens } from "@/demo/render";

/** A laid-out line: plain `text` (what width math uses) + a deferred styler. */
type Cell = { text: string; style?: (s: string) => string };
const cell = (text: string, style?: (s: string) => string): Cell => ({ text, style });

/** Truncate/pad PLAIN text to width, then apply color — so escapes never get cut. */
function fit(c: Cell, width: number): string {
  let t = c.text;
  if (t.length > width) t = width > 1 ? t.slice(0, width - 1) + "…" : t.slice(0, width);
  const padded = t + " ".repeat(Math.max(0, width - t.length));
  return c.style ? c.style(padded) : padded;
}

/**
 * Word-wrap a Cell to `width`, preserving its style on every produced line. Used
 * for the left feed column so long observations show in full (wrapped) instead of
 * being clipped with an ellipsis. Words longer than the column still fall back to
 * `fit`'s hard truncation downstream.
 */
function wrapCell(c: Cell, width: number): Cell[] {
  if (!c.text) return [cell("", c.style)];
  const lines: string[] = [];
  let cur = "";
  for (const w of c.text.split(/\s+/)) {
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= width) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.map((t) => cell(t, c.style));
}

const ARROW_EPS = 0.05;
/** Rerank delta vs. last turn: ▲ rose, ▼ fell, · steady, ＋ new this turn. */
function deltaMark(id: string, score: number, prev: Map<string, number>): string {
  if (!prev.has(id)) return chalk.cyan("＋");
  const d = score - prev.get(id)!;
  if (d > ARROW_EPS) return chalk.green("▲");
  if (d < -ARROW_EPS) return chalk.red("▼");
  return chalk.dim("·");
}

export interface PanelHeader {
  title: string;
  directives: string[];
  values: string[];
}

/**
 * A stateful split-pane surface. `renderTurn` is called once per turn with the
 * fresh trace; the panel folds it into its running state (feed history, last
 * turn's scores) and repaints the whole frame.
 */
export function createPanel(header: PanelHeader) {
  const feed: Cell[] = []; // left column, accumulates across the whole run
  const prevIntent = new Map<string, number>(); // id → intention last turn (for ▲/▼)
  let dispatch = "";

  const cols = () => Math.max(80, process.stdout.columns ?? 100);
  const rows = () => Math.max(24, process.stdout.rows ?? 30);

  function clear() {
    // Clear screen + scrollback, home the cursor — the "redraw in place" effect.
    process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
  }

  function setDispatch(label: string, reason?: string) {
    dispatch = label;
    feed.push(cell(""));
    feed.push(cell(`💤 ${label}`, chalk.bold.yellow));
    if (reason) feed.push(cell(`   ${reason}`, chalk.dim));
  }

  /** The right column: the whole mind state, rebuilt from this turn's trace. */
  function mindPanel(trace: DecisionTrace, response: string): Cell[] {
    const out: Cell[] = [];
    const { lens, recalled, produced, activated } = trace;
    const touched = new Set([...activated.entryIds, ...activated.artifactIds]);

    // -- Standing identity: the persistent core (fixed) above the shifting focus.
    out.push(cell(`★ north-star`, chalk.bold));
    out.push(cell(`  "${lens.seedIntent ?? "—"}"`, chalk.white));
    out.push(cell(`◇ values: ${lens.values.join(" · ") || "—"}`, chalk.dim));
    out.push(cell(`  (core — fixed across resets)`, chalk.dim));
    const focus = lens.activeGoals.length
      ? lens.activeGoals.map((g) => `▸${g.title} (w${f2(g.weight)})`).join("  ")
      : "—";
    out.push(cell(`▸ focus: ${focus}`, chalk.cyan));
    out.push(cell(""));

    // -- Ranked recall: artifacts (conclusions) first, then raw entries. The ▲/▼
    //    is the headline of Rung 2 — the bars move when the lens shifts.
    out.push(cell("─ recalled (ranked) ─────────────", chalk.dim));
    if (!recalled.entries.length && !recalled.artifacts.length) {
      out.push(cell("  (nothing recalled this turn)", chalk.dim));
    }
    for (const a of recalled.artifacts) {
      const mark = deltaMark(a.id, a.intention, prevIntent);
      const lit = touched.has(a.id);
      const open = isOpen(a.type) ? "  ◷open" : "";
      out.push(cell(`${mark} ◆ [${a.type}] ${a.preview}${open}`, lit ? chalk.bold : undefined));
      out.push(cell(`    intent ${bar(a.intention)} ${f2(a.intention)} · conf ${bar(a.confidence)} ${f2(a.confidence)} · inferred`, chalk.dim));
    }
    for (const e of recalled.entries) {
      const mark = deltaMark(e.id, e.intention, prevIntent);
      const lit = touched.has(e.id);
      out.push(cell(`${mark} ● ${e.preview}`, lit ? chalk.bold : undefined));
      out.push(cell(`    intent ${bar(e.intention)} ${f2(e.intention)} · conf ${bar(e.confidence)} ${f2(e.confidence)} · ${attrTag(e.attribution)}`, chalk.dim));
    }
    out.push(cell(""));

    // -- What the critic produced this turn, with provenance ⇐.
    for (const p of produced.artifacts) {
      const prov = p.sourceEntryIds.length ? `⇐ ${p.sourceEntryIds.length} clue(s)` : "⇐ —";
      const goals = p.goalLinks.length ? ` · goal×${p.goalLinks.length}` : "";
      out.push(cell(`✎ produced [${p.type}] ${p.title ?? p.preview}  ${prov}${goals}`, chalk.green));
    }
    if (activated.entryIds.length || activated.artifactIds.length) {
      out.push(cell(`↻ reinforced ${activated.entryIds.length} entr · ${activated.artifactIds.length} artifact (bolded above)`, chalk.dim));
    }
    out.push(cell(""));
    out.push(cell(`↳ "${response}"`, chalk.italic));

    return out;
  }

  /** Fold one turn into the panel and repaint the whole frame. */
  function renderTurn(args: { feed: string; response: string; trace: DecisionTrace }) {
    feed.push(cell(`> ${args.feed}`, chalk.white));

    const total = cols();
    const leftW = Math.min(48, Math.floor(total * 0.42));
    const gutter = " │ ";
    const rightW = total - leftW - gutter.length;

    const right = mindPanel(args.trace, args.response);
    const height = rows() - 6; // leave room for title + cost line
    // Word-wrap the whole feed to the column, THEN take the tail that fits — so a
    // long observation shows in full (across lines) instead of being clipped.
    const wrapped: Cell[] = [];
    for (const c of feed) wrapped.push(...wrapCell(c, leftW));
    const left = wrapped.slice(-height); // tail of the wrapped feed that fits

    const lines: string[] = [];
    // -- Title bar.
    lines.push(chalk.bold.bgBlue.white(fit(cell(`  ${header.title}  —  THE MIND, live`), total)));
    lines.push(
      chalk.dim(fit(cell(`  directives: ${header.directives.join(" · ")}`), total)),
    );
    lines.push(chalk.dim("─".repeat(total)));

    // -- Two columns.
    const body = Math.max(left.length, right.length);
    for (let i = 0; i < body; i++) {
      const l = left[i] ?? cell("");
      const r = right[i] ?? cell("");
      lines.push(fit(l, leftW) + chalk.dim(gutter) + fit(r, rightW));
    }

    // -- Cost line (#9 — a handful of selected memories, not the whole history).
    const n = args.trace.recalled.entries.length + args.trace.recalled.artifacts.length;
    lines.push(chalk.dim("─".repeat(total)));
    lines.push(
      chalk.bold.black.bgWhite(
        fit(cell(`  recalled ${n} memories · ~${estimateInjectedTokens(args.trace)} tokens injected (est.) · dispatch: ${dispatch}`), total),
      ),
    );

    // -- Update the rerank baseline for next turn, then paint.
    prevIntent.clear();
    for (const a of args.trace.recalled.artifacts) prevIntent.set(a.id, a.intention);
    for (const e of args.trace.recalled.entries) prevIntent.set(e.id, e.intention);

    clear();
    process.stdout.write(lines.join("\n") + "\n");
  }

  return { setDispatch, renderTurn, clear };
}
