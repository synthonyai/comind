/**
 * The activation reinforcement rule — the write half of the living loop
 * (Bucket B / P3), in ONE prisma-free place so every MemoryStore implementation
 * honors the same rule. Both the default Prisma adapter and the in-memory
 * reference adapter reinforce recalled memories/artifacts by this rule.
 *
 * Part of the store contract: a `MemoryStore.activateEntries` /
 * `activateArtifacts` implementation MUST apply `nextActivation` (or an
 * equivalent) so recall behaves consistently across backends.
 */

/** Reinforcement constants. Deliberately explicit and tunable in one place. */
export const ACTIVATION = {
  /** accessScore gained per activation (fast/fragile reachability), capped at 1. */
  ACCESS_INCREMENT: 0.1,
  /** consolidationScore baseline — matches the schema default for never-activated rows. */
  CONSOLIDATION_BASE: 0.3,
  /** consolidationScore gained per cumulative activation (slow/durable), capped at 1. */
  CONSOLIDATION_PER_ACTIVATION: 0.05,
} as const;

/** Current operational signals an activation reads. */
export interface ActivationSignals {
  accessScore: number;
  activationCount: number;
}

/** New operational signals after one activation. Mirrors the Prisma adapter's atomic SQL. */
export interface ActivatedSignals {
  accessScore: number;
  consolidationScore: number;
  activationCount: number;
  lastActivatedAt: Date;
}

/**
 * Compute the post-activation signals for a memory/artifact that was just used.
 * consolidationScore is recomputed from the POST-increment activationCount, so a
 * heavily-used row keeps a high durable floor regardless of its prior value.
 */
export function nextActivation(current: ActivationSignals, now: Date = new Date()): ActivatedSignals {
  const activationCount = current.activationCount + 1;
  return {
    activationCount,
    lastActivatedAt: now,
    accessScore: Math.min(1, current.accessScore + ACTIVATION.ACCESS_INCREMENT),
    consolidationScore: Math.min(
      1,
      ACTIVATION.CONSOLIDATION_BASE + activationCount * ACTIVATION.CONSOLIDATION_PER_ACTIVATION
    ),
  };
}
