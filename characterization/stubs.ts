/**
 * Shared test doubles + assertion harness for the characterization oracles.
 * --------------------------------------------------------------------------
 * These oracles pin CoMind's cognitive behavior WITHOUT a database or any API
 * keys: they run the real runtime against the in-memory reference store, with a
 * deterministic stub embedder and a stub LLM. Everything here is pure and
 * reproducible, so the oracles are safe to run in CI.
 *
 * (The private `comind-vantage` monorepo keeps the Postgres + HuggingFace
 * versions of these oracles as the live-backend regression harness. These are
 * the Prisma-free ports of the same behavioral contract.)
 */

import type { EmbeddingProvider, LLMProvider, ExtractionOutput, LLMJob } from "@/lib/comind";

/** What a stub turn returns: the reply text and the extraction output. */
export interface StubTurn {
  response: string;
  memoryCritic: ExtractionOutput;
}

/**
 * Deterministic, key-free embedder: hashed bag-of-words, unit-normalized.
 * Shared words -> closer vectors, so similarity (and thus recall) is meaningful
 * even though the space is synthetic. 128 dims keeps hash collisions low enough
 * that topical overlap dominates the ordering.
 */
export class StubEmbeddings implements EmbeddingProvider {
  readonly dimensions = 128;
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
  async embed(text: string) {
    return this.vec(text);
  }
  async embedQuery(text: string) {
    return this.vec(text);
  }
}

/**
 * A deterministic LLMProvider — streams a fixed reply and returns a fixed
 * extraction output, no network. Records every call (job + prompt) so oracles
 * can assert what the library sent.
 */
export class StubLLM implements LLMProvider {
  readonly calls: { job: LLMJob; prompt: string }[] = [];
  constructor(private readonly out: StubTurn) {}
  async *streamText(params: { job: LLMJob; system: string; messages: { role: string; content: string }[] }): AsyncIterable<string> {
    this.calls.push({ job: params.job, prompt: params.system + "\n" + params.messages.map((m) => m.content).join("\n") });
    // Two chunks, to exercise stream collection.
    const half = Math.ceil(this.out.response.length / 2);
    yield this.out.response.slice(0, half);
    yield this.out.response.slice(half);
  }
  async generateStructured<T>(params: { job: LLMJob; prompt: string }): Promise<T> {
    this.calls.push({ job: params.job, prompt: params.prompt });
    return this.out.memoryCritic as unknown as T;
  }
}

/**
 * A tiny assertion harness. Each oracle makes one and reports at the end;
 * `report()` sets a non-zero exit code on any failure so CI goes red.
 */
export function makeChecker(tag: string) {
  const failures: string[] = [];

  const fmt = (v: unknown) => (typeof v === "number" ? String(v) : JSON.stringify(v));

  /** Deep-ish equality: arrays compared by JSON, numbers with a small tolerance. */
  function check(label: string, actual: unknown, expected: unknown) {
    let ok: boolean;
    if (typeof actual === "number" && typeof expected === "number") {
      ok = Math.abs(actual - expected) < 1e-9;
    } else if (Array.isArray(expected) || typeof expected === "object") {
      ok = JSON.stringify(actual) === JSON.stringify(expected);
    } else {
      ok = actual === expected;
    }
    if (ok) console.log(`  ✅ ${label}: ${fmt(actual)}`);
    else {
      failures.push(`${label}: expected ${fmt(expected)}, got ${fmt(actual)}`);
      console.log(`  ❌ ${label}: expected ${fmt(expected)}, got ${fmt(actual)}`);
    }
  }

  /** Assert a boolean invariant (with optional detail printed on failure). */
  function checkTrue(label: string, cond: boolean, detail?: unknown) {
    if (cond) console.log(`  ✅ ${label}`);
    else {
      failures.push(`${label}${detail !== undefined ? ` — ${fmt(detail)}` : ""}`);
      console.log(`  ❌ ${label}${detail !== undefined ? ` — ${fmt(detail)}` : ""}`);
    }
  }

  /** Print the verdict and set process.exitCode. Returns true on pass. */
  function report(): boolean {
    if (failures.length === 0) {
      console.log(`[${tag}] ✅ PASS`);
      return true;
    }
    console.log(`[${tag}] ❌ FAIL:`);
    failures.forEach((f) => console.log("  " + f));
    process.exitCode = 1;
    return false;
  }

  return { check, checkTrue, report };
}
