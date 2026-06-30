/**
 * Rung 1 renderer — pretty-prints the evolving mind-state each turn from the
 * `DecisionTrace`. Pure: (trace + a little context) → string. No TUI, no
 * interactivity — a scrolling transcript (the PRD's first cut). Higher rungs
 * (Ink/blessed split-pane) render the SAME trace; only the surface changes.
 */

import type { DecisionTrace, AttributionType } from "@/lib/comind";

const BAR_WIDTH = 5;

/**
 * Told-vs-inferred (#10). The schema's `AttributionType` is the source of truth;
 * the demo collapses it to the layperson binary. AGENT_INFERRED = the mind
 * figured it out; everything else (USER_EXPLICIT / SYSTEM_IMPORT) came from
 * outside, so the mind was *told*.
 */
export function attrTag(a: AttributionType): string {
  return a === "AGENT_INFERRED" ? "inferred" : "told";
}

/** Open commitments the mind carries forward (#12): unresolved QUESTIONs and owed TASKs. */
export function isOpen(artifactType: string): boolean {
  return artifactType === "QUESTION" || artifactType === "TASK";
}

/** A 0..1 score as a small bar, e.g. .82 -> "▰▰▰▰▱". */
export function bar(score: number): string {
  const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round(score * BAR_WIDTH)));
  return "▰".repeat(filled) + "▱".repeat(BAR_WIDTH - filled);
}

export const f2 = (n: number) => n.toFixed(2);

/** Rough token estimate from the recalled set actually injected (chars/4). */
export function estimateInjectedTokens(trace: DecisionTrace): number {
  const chars =
    trace.recalled.entries.reduce((s, e) => s + e.preview.length, 0) +
    trace.recalled.artifacts.reduce((s, a) => s + a.preview.length, 0);
  return Math.ceil(chars / 4);
}

/** The standing-identity header, shown once when the world is seeded. */
export function renderWorldHeader(world: {
  title: string;
  directives: string[];
  values: string[];
  goals: { title: string; weight: number }[];
}): string {
  const lines = [
    `\n══ ${world.title} ══`,
    `  identity · directives: ${world.directives.join(" · ") || "—"}`,
    `           · values: ${world.values.join(", ") || "—"}`,
    `  goals:`,
    ...world.goals.map((g) => `    ▸ ${g.title}  (w ${f2(g.weight)})`),
  ];
  return lines.join("\n");
}

export function renderDispatchBanner(label: string, reason?: string): string {
  return `\n\n💤 ────────── ${label} ──────────\n${reason ? `   ${reason}\n` : ""}`;
}

/**
 * The standing lens — rendered EVERY turn on purpose. The north-star + values
 * are the persistent core: they never move across resets or goal-completions, so
 * you can watch them hold steady while the `focus` line (active goals) shifts
 * beneath them. That visible contrast IS the #4/#13 claim — a standing identity,
 * not a goal dial.
 */
function renderLens(lens: DecisionTrace["lens"]): string[] {
  const focus = lens.activeGoals.length
    ? lens.activeGoals.map((g) => `▸${g.title} (w${f2(g.weight)})`).join(" · ")
    : "—";
  return [
    `  lens · ★ north-star: "${lens.seedIntent ?? "—"}"`,
    `       · ◇ values: ${lens.values.join(" · ") || "—"}   (core — fixed)`,
    `       · ▸ focus: ${focus}`,
  ];
}

/** One turn: the case-feed line, then the mind panel rendered from the trace. */
export function renderTurn(args: {
  feed: string;
  response: string;
  trace: DecisionTrace;
}): string {
  const { feed, response, trace } = args;
  const out: string[] = [];

  out.push(`\n> ${feed}`);

  // --- The standing lens (persistent core + shifting focus) ----------------
  out.push(...renderLens(trace.lens));

  // --- The mind panel ------------------------------------------------------
  const { entries, artifacts } = trace.recalled;
  if (entries.length || artifacts.length) {
    out.push(`  ┌─ THE MIND ─ recalled (ranked) ────────────`);
    // Each item shows three signals the schema already tracks: intention (the
    // re-rank), confidence (#11 — how sure), and attribution (#10 — told vs.
    // inferred). Artifacts are inferred by construction; QUESTION/TASK get an
    // "open" flag (#12) since they're commitments the mind carries forward.
    for (const a of artifacts) {
      const open = isOpen(a.type) ? "   ◷ open" : "";
      out.push(`  │ ◆ [${a.type}] ${a.preview}${open}`);
      out.push(`  │     intent ${bar(a.intention)} ${f2(a.intention)} · conf ${bar(a.confidence)} ${f2(a.confidence)} · inferred`);
    }
    for (const e of entries) {
      out.push(`  │ ● ${e.preview}`);
      out.push(`  │     intent ${bar(e.intention)} ${f2(e.intention)} · conf ${bar(e.confidence)} ${f2(e.confidence)} · ${attrTag(e.attribution)}`);
    }
    out.push(`  └────────────────────────────────────────────`);
  } else {
    out.push(`  ┌─ THE MIND ─ (nothing recalled this turn) ──┐`);
    out.push(`  └────────────────────────────────────────────┘`);
  }

  // --- What the critic produced (with provenance ⇐) ------------------------
  for (const p of trace.produced.artifacts) {
    const prov = p.sourceEntryIds.length ? `⇐ ${p.sourceEntryIds.length} clue(s)` : "⇐ —";
    const goals = p.goalLinks.length ? ` · goal×${p.goalLinks.length}` : "";
    out.push(`  ✎ produced [${p.type}] ${p.title ?? p.preview}  ${prov}${goals}`);
  }

  // --- The living loop (what got reinforced this turn) ---------------------
  const act = trace.activated;
  if (act.entryIds.length || act.artifactIds.length) {
    out.push(`  ↻ reinforced: ${act.entryIds.length} entr(ies), ${act.artifactIds.length} artifact(s)`);
  }

  // --- Response + cost line ------------------------------------------------
  out.push(`  ↳ "${response}"`);
  out.push(
    `  [ recalled ${entries.length + artifacts.length} memories · ~${estimateInjectedTokens(trace)} tokens injected (est.) ]`,
  );

  return out.join("\n");
}
