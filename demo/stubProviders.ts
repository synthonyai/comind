/**
 * Deterministic, key-free providers for the demo's `--offline` path.
 * ---------------------------------------------------------------------------
 * - `StubEmbeddings`: hashed bag-of-words, unit-normalized. Shared words → closer
 *   vectors, so recall is meaningful (if synthetic). Same construction as
 *   proveBoundary.ts — kept here so the playable demo can share it.
 * - `ScriptedLLM`: replays a queue of pre-authored `AgentActionOutput`s, one per
 *   `runAgent` call, in turn order. The real-provider path uses a live LLM
 *   instead; this is only for reproducible, no-key runs.
 */

import type { EmbeddingProvider, LLMProvider, AgentActionOutput } from "@/lib/comind";

export class StubEmbeddings implements EmbeddingProvider {
  readonly dimensions = 64;
  private vec(text: string): number[] {
    const v = new Array(this.dimensions).fill(0);
    for (const tok of text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
      let h = 0;
      for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) >>> 0;
      v[h % this.dimensions] += 1;
    }
    const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / n);
  }
  async embed(text: string) { return this.vec(text); }
  async embedQuery(text: string) { return this.vec(text); }
}

/**
 * Returns a pre-set critic output for the next call. The harness calls
 * `setNext(...)` right before each `runAgent`, AFTER it has stored that turn's
 * observation — so the canned artifacts can cite the just-created entry id
 * (provenance can't be resolved up front, since the ids don't exist yet).
 */
export class ScriptedLLM implements LLMProvider {
  private pending: AgentActionOutput | null = null;
  private readonly empty: AgentActionOutput = {
    response: "",
    memoryCritic: { artifacts: [], updatesToRecalledMemories: [] },
  };
  setNext(output: AgentActionOutput): void {
    this.pending = output;
  }
  async generateStructured<T>(): Promise<T> {
    const out = this.pending ?? this.empty;
    this.pending = null;
    return out as unknown as T;
  }
}
