// lib/comind/agentRuntime/tokenBudget.ts
import type { AgentContextData } from '@/lib/comind/agentRuntime/types';

/** Generous default budget for the recall-driven memory blocks (not the whole prompt). */
const DEFAULT_MAX_TOKENS = 4000;
/** Rough chars→tokens heuristic (no tokenizer dependency); ~4 chars/token. */
const DEFAULT_CHARS_PER_TOKEN = 4;
/** Mirrors promptAssembler's per-item content truncation, so the estimate matches what's emitted. */
const ITEM_CONTENT_CAP = 300;
/** Per-item prompt overhead (the `[ID:…]`/prefix/separator scaffolding). */
const PER_ITEM_OVERHEAD_TOKENS = 12;

function estimateItemTokens(content: string, charsPerToken: number): number {
  const chars = Math.min(content.length, ITEM_CONTENT_CAP);
  return Math.ceil(chars / charsPerToken) + PER_ITEM_OVERHEAD_TOKENS;
}

export interface TokenBudgetOptions {
  /** Budget, in estimated tokens, for the recall-driven memory blocks. */
  maxTokens?: number;
  /** Estimation heuristic (chars per token). */
  charsPerToken?: number;
}

/**
 * Token budget + eviction (Bucket E / step 4). The recall-driven memory blocks —
 * derived artifacts, intention-weighted entries, recent context — are the only
 * unbounded part of the assembled prompt; the static blocks (identity, context,
 * goals, directives) are bounded by the context config. This trims those three
 * lists to fit a token budget, evicting the LOWEST-priority items.
 *
 * Priority (highest first): derived artifacts (distilled, deduped meaning) →
 * intention-weighted entries (ranked relevant raw memory) → recent context
 * (supplementary). Within each list the existing rank order is preserved and the
 * tail that doesn't fit is dropped (rank-ordered prefix — a smaller lower-rank
 * item never displaces a larger higher-rank one). Applied BEFORE prompt assembly
 * so activation and the decision trace reflect only what actually went in.
 */
export function applyContextTokenBudget(
  data: AgentContextData,
  options: TokenBudgetOptions = {}
): AgentContextData {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const charsPerToken = options.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN;

  let remaining = maxTokens;
  const fit = <T extends { content: string }>(items: T[]): T[] => {
    const kept: T[] = [];
    for (const item of items) {
      const cost = estimateItemTokens(item.content, charsPerToken);
      if (cost > remaining) break;
      remaining -= cost;
      kept.push(item);
    }
    return kept;
  };

  return {
    ...data,
    artifacts: fit(data.artifacts),
    intentionWeighted: fit(data.intentionWeighted),
    recentContext: fit(data.recentContext),
  };
}
