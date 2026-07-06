/**
 * demo/renderAwakePanel.ts — the v0.2 AWAKE panel (the "mind portrait").
 *
 * Renders the standing state as the whiteboard layout from CoMind-AwakeState.png,
 * NOT a scrolling chat: a fixed governing self on top, two memory zones (RIDING
 * WITH ME = generally-useful/promoted · SURFACED NOW = currently-relevant/recalled)
 * each carrying the "needs attention" dials (W weight/relevance · C confidence ·
 * S stability), then FOCUS (active goals, leader first) and WHERE I LEFT OFF.
 *
 * Pure: an `AwakeView` model -> string. The driver (awaken.ts) builds the view
 * from `wake()` + `recall()`; this file only draws. `W` is the LIVE intention/
 * relevance score (the thing that re-ranks when priorities change — the demo's
 * centerpiece), which is why it leads each row.
 */

import { bar, f2 } from "@/demo/render";

const WIDTH = 64;

/** One memory line in a zone, with its three attention dials. */
export interface AwakeRow {
  content: string;
  /** LIVE intention/relevance — how much this weighs on the current focus (the mover). */
  weight: number;
  confidence: number;
  /** consolidationScore — how settled the belief is; climbs with use. */
  stability: number;
  /** short context tag (scope), e.g. "infra". */
  scope: string;
  /** dimmer if it came from a neighbouring context (soft-membership). */
  own: boolean;
}

export interface AwakeFocus {
  title: string;
  weight: number;
  /** the leading priority (rendered with ⚑, first). */
  lead: boolean;
  /** stood-down goals render greyed. */
  standDown?: boolean;
}

export interface AwakeView {
  name: string;
  directives: string[];
  values: string[];
  /** #4 promoted — generally-useful beliefs riding across wakes. */
  ridingWithMe: AwakeRow[];
  /** currently-relevant memories under the focus (ranked). */
  surfacedNow: AwakeRow[];
  focus: AwakeFocus[];
  leftOff: string | null;
  /** optional one-line banner (e.g. the wipe report), shown just under the title. */
  banner?: string;
}

const hr = (l: string, r: string, fill = "─") => l + fill.repeat(WIDTH) + r;

/** Wrap text to the panel width with a hanging indent. */
function wrap(prefix: string, text: string, indent: string): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = prefix;
  const max = WIDTH - 1;
  for (const w of words) {
    if ((line + " " + w).trimEnd().length > max && line.trim() !== prefix.trim()) {
      lines.push(line);
      line = indent + w;
    } else {
      line = line === prefix ? line + w : line + " " + w;
    }
  }
  if (line.trim()) lines.push(line);
  return lines;
}

/** Left-pad a row to the interior width so the right border lines up. */
function pad(s: string): string {
  // strip is unnecessary here; callers keep within width. Pad to WIDTH.
  const visible = s.length;
  return s + " ".repeat(Math.max(0, WIDTH - visible));
}

function dials(r: AwakeRow): string {
  return `W${bar(r.weight)} C${bar(r.confidence)} S${bar(r.stability)}`;
}

function renderZone(rows: AwakeRow[], emptyLabel: string, marker: string): string[] {
  if (rows.length === 0) return [`   ${emptyLabel}`];
  const out: string[] = [];
  for (const r of rows) {
    const dim = r.own ? "" : " ·(neighbour)";
    out.push(...wrap(`  ${marker} `, `${r.content}${dim}`, "     "));
    out.push(`      ${dials(r)}  ·${r.scope}`);
  }
  return out;
}

export function renderAwakePanel(v: AwakeView): string {
  const out: string[] = [];
  out.push(hr("┌─ " + v.name + " · AWAKE ", "┐").replace(/─+┐$/, (m) => m)); // top
  // Rebuild top border cleanly (title inline):
  out.pop();
  const title = `┌─ ${v.name} · AWAKE `;
  out.push(title + "─".repeat(Math.max(0, WIDTH + 2 - title.length)) + "┐");

  const push = (s: string) => out.push("│" + pad(s) + "│");

  if (v.banner) {
    push(`  ${v.banner}`);
  }

  // WHO I AM — governing, fixed.
  push(`  WHO I AM   (governing · never changes)`);
  for (const l of wrap(`   directives: `, v.directives.join(" · ") || "—", "     ")) push(l);
  push(`   values:     ${v.values.join(" · ") || "—"}`);

  // Divider into the two memory zones.
  out.push(hr("├", "┤"));
  push(`  RIDING WITH ME            SURFACED NOW`);
  push(`  (generally useful·pinned) (matters to the focus)`);
  out.push(...renderZone(v.ridingWithMe, "— nothing pinned yet —", "★").map((s) => "│" + pad(s) + "│"));
  push(`  ·  ·  ·`);
  out.push(...renderZone(v.surfacedNow, "— nothing surfaced —", "•").map((s) => "│" + pad(s) + "│"));

  // FOCUS + carryover.
  out.push(hr("├", "┤"));
  push(`  FOCUS`);
  for (const g of v.focus) {
    const tag = g.lead ? "▸ ⚑" : g.standDown ? "· " : "▸ ";
    const note = g.lead ? "   ← leads" : g.standDown ? "   (stood down)" : "";
    for (const l of wrap(`    ${tag} `, `${g.title} (w ${f2(g.weight)})${note}`, "       ")) push(l);
  }
  const carry = v.leftOff ? `"${v.leftOff}"` : "— (nothing left off yet)";
  for (const l of wrap(`  WHERE I LEFT OFF  `, carry, "     ")) push(l);

  out.push(hr("└", "┘"));
  out.push(`   W weight/relevance · C confidence · S stability   (bars move)`);
  return out.join("\n");
}
