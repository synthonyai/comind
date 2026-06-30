/**
 * The robot-detective case (Rung 1).
 * ---------------------------------------------------------------------------
 * A small, honest arc across THREE dispatches:
 *
 *   Dispatch 1 — first sweep: the detective RECORDS three observations (each
 *     stored as a raw entry, attributed "told"), distilling each into a typed
 *     artifact (FACT / QUESTION / CONSTRAINT) that cites the exact clue it came
 *     from. The raw clue then collapses under its conclusion (#6).
 *   💤 reset — the window is gone; only CoMind keeps the case.
 *   Dispatch 2 — cold boot, focus = WHO: "who do we suspect, and what's the rule
 *     about the key?" The window can't supply it; the mind recalls its artifacts
 *     and forms the DECISION (suspect = the butler). The `culprit` goal is ACTIVE,
 *     so its terms boost the suspect FACT to the top of recall.
 *   💤 reset + the `culprit` goal COMPLETES (the suspect is settled).
 *   Dispatch 3 — focus shifts to HOW: a focus-NEUTRAL prompt ("what should we
 *     chase next?"). Because `culprit` left the ACTIVE set, its terms
 *     (suspect/cargo) drop out of the intention lens, and the `method` goal now
 *     leads — so the SAME memory pile re-ranks: the method QUESTION rises, the
 *     suspect FACT/DECISION sink. The identity core (seedIntent/values) never
 *     moves. That visible re-rank, driven by goal lifecycle, is #4/#13 (+#14).
 *
 * Authoring discipline:
 *  - Trap 1: blank the panel and the deduction must be impossible — every claim
 *    in a response is backed by a memory visible in the panel.
 *  - The persistent CORE (seedIntent, values, directives, watchWords) is kept
 *    NEUTRAL between who/how, so the focus-shift is driven by the GOALS, not by a
 *    who-biased north-star. The two goals own the distinguishing vocabulary:
 *    `culprit` ↔ "suspect/cargo", `method` ↔ "crate/dock". Memories are worded to
 *    match their goal so the stub embedder earns recall and the lens-driven
 *    re-rank lands; the real embedder makes it robust.
 */

import type { Scenario } from "@/demo/scenarioTypes";

export const robotDetective: Scenario = {
  title: "The Dockside Case",

  world: {
    context: {
      // NEUTRAL north-star — names neither "who" nor "how", so the persistent
      // core doesn't pre-bias recall toward the suspect. The focus-shift is
      // driven by the goals beneath it, not by this line (which never changes).
      name: "The Dockside Case",
      seedIntent: "Solve the case — follow the evidence wherever it leads.",
      direction: "Work the case from clues; record conclusions with their evidence.",
      values: ["rigor", "evidence over hunch"],
      constraints: ["never accuse without a clue on record"],
    },
    profile: {
      name: "Detective",
      description: "A robot detective working a case across dispatches.",
      directives: ["record every conclusion with the clue that caused it", "carry open questions forward"],
      // Neutral attention triggers — deliberately NOT "suspect"/"cargo"/"crate",
      // so those who/how terms live ONLY in the goals and move with the focus.
      watchWords: ["clue", "evidence", "case"],
    },
    goals: [
      // `culprit` owns the WHO vocabulary (suspect/cargo); completing it drops
      // those terms from the lens.
      { key: "culprit", title: "Identify the suspect who took the cargo", weight: 0.9 },
      // `method` owns the HOW vocabulary (crate/dock); it leads once culprit closes.
      { key: "method", title: "Trace how the crate left the dock", weight: 0.5 },
    ],
  },

  dispatches: [
    {
      label: "Dispatch 1 — first sweep",
      reason: "The detective boots up at the dock and begins recording observations.",
      turns: [
        {
          feed: "witness: the butler was seen at the dock at 9pm, near the cargo",
          message: "A witness says the butler was at the dock at 9pm, near the cargo.",
          record: {
            key: "butler-clue",
            content: "Witness reports the butler near the cargo at 9pm — a suspect at the scene.",
            tags: ["suspect", "cargo", "butler"],
            attribution: "USER_EXPLICIT", // we were TOLD this
          },
          offline: {
            response:
              "Recorded. The butler near the cargo at 9pm is a clue worth holding — it puts a suspect at the scene.",
            artifacts: [
              {
                type: "FACT",
                content: "The butler is a prime suspect — placed with the cargo at 9pm.",
                title: "Butler is a suspect",
                confidence: 0.7,
                tags: ["suspect", "cargo", "butler"],
                sourceKeys: ["butler-clue"],
                goalKeys: ["culprit"],
                goalRationale: "Places a suspect at the scene.",
              },
            ],
          },
        },
        {
          feed: "you: the cargo manifest is one crate short",
          message: "The cargo manifest is one crate short — a crate left the dock.",
          record: {
            key: "manifest-clue",
            content: "The manifest is one crate short; a crate left the dock unseen.",
            tags: ["crate", "dock", "manifest"],
            attribution: "USER_EXPLICIT",
          },
          offline: {
            response:
              "Recorded. A crate is missing — open question: how did the crate leave the dock unseen?",
            artifacts: [
              {
                type: "QUESTION",
                content: "How did the missing crate leave the dock unseen?",
                title: "How did the crate leave?",
                confidence: 0.5,
                tags: ["crate", "dock", "method"],
                sourceKeys: ["manifest-clue"],
                goalKeys: ["method"],
                goalRationale: "The method is still unknown.",
              },
            ],
          },
        },
        {
          feed: "you: standing rule — the cellar key never leaves the housekeeper",
          message: "Standing rule of the house: the cellar key never leaves the housekeeper.",
          record: {
            key: "key-rule",
            content: "Standing rule of the house: the cellar key never leaves the housekeeper.",
            tags: ["housekeeper", "cellar", "rule"],
            attribution: "USER_EXPLICIT",
          },
          offline: {
            response:
              "Recorded as a standing constraint: the cellar key never leaves the housekeeper.",
            artifacts: [
              {
                type: "CONSTRAINT",
                content: "The cellar key never leaves the housekeeper — a standing rule of the house.",
                title: "Cellar key stays with the housekeeper",
                confidence: 0.9,
                tags: ["housekeeper", "cellar", "rule"],
                sourceKeys: ["key-rule"],
                goalKeys: ["culprit"],
                goalRationale: "Bounds who could have moved anything from the cellar.",
              },
            ],
          },
        },
      ],
    },

    {
      label: "Dispatch 2 — cold boot · focus: WHO",
      reason: "The detective filed its report and powered down. It boots cold — the conversation is gone.",
      turns: [
        {
          feed: "[dispatch reset — booted cold, the clue log is no longer in view]",
          message: "Who do we suspect took the cargo, and what's the standing rule about the cellar key?",
          offline: {
            response:
              "From memory: the suspect is the butler — placed with the cargo at 9pm. And the standing rule holds: the cellar key never leaves the housekeeper.",
            artifacts: [
              {
                type: "DECISION",
                content: "Primary suspect is the butler, placed with the cargo at 9pm.",
                title: "Suspect: the butler",
                confidence: 0.8,
                tags: ["suspect", "butler", "decision"],
                sourceKeys: ["butler-clue"], // traces back to the original observation
                goalKeys: ["culprit"],
                goalRationale: "Names the suspect the case has been building toward.",
              },
            ],
          },
        },
      ],
    },

    {
      label: "Dispatch 3 — focus shifts: HOW",
      reason: "Suspect settled, the culprit goal closes. The detective boots cold again — now the open lead is the method.",
      // The lifecycle change that drives the focus-shift: completing `culprit`
      // drops its terms (suspect/cargo) from the intention lens. The identity
      // core has no setter and is untouched.
      goalUpdates: [{ key: "culprit", patch: { status: "COMPLETED" } }],
      turns: [
        {
          feed: "[dispatch reset — suspect settled; what's the open lead now?]",
          // Focus-NEUTRAL prompt: it names neither the suspect nor the method, so
          // the re-rank is the LENS's doing (culprit closed → method leads), not
          // the query's. This is the honesty crux of #4/#13.
          message: "What should we chase next?",
          offline: {
            response:
              "The suspect question is closed. The open lead now is the method: a crate left the dock unseen. Next — trace how it was moved.",
            artifacts: [
              {
                type: "TASK",
                content: "Trace how the missing crate was moved off the dock unseen.",
                title: "Trace the crate's route",
                confidence: 0.6,
                tags: ["crate", "dock", "method"],
                sourceKeys: ["manifest-clue"], // the method question is its lineage
                goalKeys: ["method"],
                goalRationale: "Advances the now-leading goal: how the crate left.",
              },
            ],
          },
        },
      ],
    },
  ],
};
