/**
 * v0.2 demo renderer — the WAKE pane.
 *
 * Pretty-prints a `ContinuityState` packet (the return value of
 * `comind.wake()` / `assembleContinuityState()`). Same panel lineage as the
 * v0.1 `renderTurn`, a different payload: this shows the standing state
 * assembled BEFORE any input — governing frame + foreground, plus the carryover
 * and promoted slots.
 *
 * Beat 1 of the v0.2 demo ("wake without a query"). The carryover/promoted
 * slots render as explicit "— (empty until item C)" placeholders, so the panel
 * already has the final shape; items C/D drop their content into slots that
 * render today. Pure: packet -> string.
 */

import type { ContinuityState } from "@/lib/comind";
import { f2 } from "@/demo/render";

export function renderContinuityState(state: ContinuityState): string {
  const { governing, foreground, carryover, promoted } = state;

  const directives = governing.agentProfile?.directives ?? [];
  const values = governing.context?.values ?? [];
  const seedIntent = governing.context?.seedIntent ?? null;

  const out: string[] = [];
  out.push(`\n╔═ WAKE · standing state assembled (no query · no engine) ═════════════`);

  // #1 Governing — constitutive, present by rule.
  out.push(`  governing · ★ north-star: "${seedIntent ?? "—"}"`);
  out.push(`            · ◆ directives: ${directives.join(" · ") || "—"}`);
  out.push(`            · ◇ values: ${values.join(", ") || "—"}   (core — fixed)`);

  // #2 Foreground — where the mind is pointed now.
  const goals = foreground.activeGoals.length
    ? foreground.activeGoals.map((g) => `▸ ${g.title} (w ${f2(g.weight)})`).join("   ")
    : "—";
  out.push(`  foreground · goals: ${goals}`);

  // #3 Carryover — the session-end SUMMARY, loaded first at wake (item C, built).
  // Empty on a cold boot simply means nothing has been checkpointed yet.
  const carry = carryover.summary
    ? `“${carryover.summary.content}”`
    : "— (no checkpoint yet — nothing left off)";
  out.push(`  carryover · ${carry}`);

  // #4 Promoted — the "sticky" beliefs riding the packet across wakes (item C).
  if (promoted.artifacts.length) {
    out.push(`  promoted  · ${promoted.artifacts.length} belief(s) with earned standing:`);
    for (const a of promoted.artifacts) {
      out.push(`            · ◆ [${a.type}] ${a.title ?? a.content}  (standing ${f2(a.consolidationScore)})`);
    }
  } else {
    out.push(`  promoted  · — (nothing promoted yet)`);
  }

  out.push(`╚═════════════════════════════════════════════════════════════════════`);
  return out.join("\n");
}
