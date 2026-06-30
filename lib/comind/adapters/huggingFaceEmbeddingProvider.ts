/**
 * HuggingFaceEmbeddingProvider — the default EmbeddingProvider, wrapping
 * `lib/embeddings.ts` (BAAI/bge-large-en-v1.5, 1024 dims via the HF API).
 *
 * Phase 3 of V01_IMPLEMENTATION_PLAN.md — additive and DORMANT. Mirrors the
 * normalize + length-check behavior of the inline `embed`/`embedQuery` helpers
 * in `memory.ts`, so stored and query vectors stay unit-length (consistent with
 * the `<->` distance used by PrismaMemoryStore.searchSimilar).
 */

import { generateEmbedding } from '@/lib/comind/embeddings';
import type { EmbeddingProvider } from '@/lib/comind/providers';

const DIMENSIONS = 1024;

function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

export class HuggingFaceEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = DIMENSIONS;

  async embed(text: string): Promise<number[]> {
    return this.run(text, 'memory');
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.run(text, 'query');
  }

  private async run(text: string, instructionType: 'memory' | 'query'): Promise<number[]> {
    const vec = await generateEmbedding({
      content: text,
      instructionType,
      privacyLevel: 'private',
    });
    if (!vec) throw new Error('Embedding generation failed');
    if (vec.length !== this.dimensions) {
      throw new Error(`Expected ${this.dimensions} dims, got ${vec.length}`);
    }
    return normalize(vec);
  }
}
