/**
 * Scenario types for the reference demo (Rung 1 — scripted transcript).
 * ---------------------------------------------------------------------------
 * A `Scenario` is pure data: the world to seed, then an ordered list of
 * `Dispatch`es (the reset boundaries), each a list of `Turn`s. It carries an
 * **offline script** — the deterministic critic output used under `--offline`
 * so the transcript runs with no API keys. Under the real-provider path the
 * offline script is ignored and a live LLM derives the artifacts itself.
 *
 * Authoring rule (Trap 1 in the PRD): the "smart" recalls must be *earned*. Word
 * overlap between a later question and the clue that should surface it is what
 * makes recall land under the stub embedder; the real embedder makes it robust.
 */

import type { MemoryArtifactType, AttributionType, GoalPatch } from "@/lib/comind";

/** The standing world the case runs in (seeded once, before any dispatch). */
export interface WorldSeed {
  context: {
    name: string;
    seedIntent: string;
    direction?: string;
    values?: string[];
    constraints?: string[];
  };
  profile: {
    name?: string;
    description: string;
    directives: string[];
    watchWords: string[];
  };
  /** Weighted goals; `key` is a logical handle the offline script links to. */
  goals: { key: string; title: string; weight: number }[];
  /** Optional pre-seeded memories — e.g. a rule "given once, early". */
  seedMemories?: {
    content: string;
    tags?: string[];
    attributionType?: AttributionType;
    importanceScore?: number;
  }[];
}

/** One canned artifact for the offline critic; goals + sources referenced by key. */
export interface ScriptedArtifact {
  type: MemoryArtifactType;
  content: string;
  title?: string;
  confidence?: number;
  tags?: string[];
  /** Goal keys (from `WorldSeed.goals[].key`) this artifact serves. */
  goalKeys?: string[];
  goalRationale?: string;
  /**
   * Record keys (from a turn's `record.key`) this artifact was distilled from —
   * its provenance (#7). Resolved to entry ids at run time. Authoring these
   * EXPLICITLY (rather than letting the runtime fall back to "all recalled
   * entries") is what keeps provenance truthful and prefer-artifact dedup honest.
   */
  sourceKeys?: string[];
}

/** A single beat: what the viewer sees (`feed`), what the agent gets (`message`). */
export interface Turn {
  /** The case-feed line shown on the left. */
  feed: string;
  /** The message passed to `runAgent`. */
  message: string;
  /**
   * If set, the harness stores this as a raw `MemoryEntry` BEFORE running the
   * turn — the detective *recording an observation*. `key` lets later artifacts
   * cite it as a source. This mirrors the real CAMA loop: observation → entry →
   * recall → distilled artifact (which then supersedes the raw entry, #6).
   */
  record?: {
    key: string;
    content: string;
    tags?: string[];
    attribution?: AttributionType;
  };
  /** Deterministic critic output used only under `--offline`. */
  offline: { response: string; artifacts?: ScriptedArtifact[] };
}

/** A dispatch = a session window. Its boundary is where the context resets. */
export interface Dispatch {
  label: string;
  /** Fiction for the reset ("filed the report and powered down"). */
  reason?: string;
  /**
   * Goal-lifecycle changes applied at the dispatch boundary (after the reset,
   * before the turns run). Completing a goal (`status: 'COMPLETED'`) drops its
   * terms from the intention lens, so the SAME memory pile re-ranks beneath the
   * unchanged identity core — the #4/#13 focus-shift, driven by #14. `key`
   * references `WorldSeed.goals[].key`.
   */
  goalUpdates?: { key: string; patch: GoalPatch }[];
  turns: Turn[];
}

export interface Scenario {
  title: string;
  world: WorldSeed;
  dispatches: Dispatch[];
}
