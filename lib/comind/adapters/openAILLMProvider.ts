/**
 * OpenAILLMProvider — the default LLMProvider, wrapping the same Vercel-AI
 * `generateObject` call as `lib/llm.ts`, but generic over the schema CoMind
 * passes in (the provider just fills it).
 *
 * Phase 3 of V01_IMPLEMENTATION_PLAN.md — additive and DORMANT. The concrete
 * model lives HERE, not on the interface: it owns the `gpt-4o` default, so
 * swapping models means swapping/configuring this provider with no change to
 * the cognitive layer.
 */

import { openai } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import type { z } from 'zod';
import type { LLMProvider } from '@/lib/comind/providers';

export interface OpenAILLMProviderOptions {
  /** Defaults to `gpt-4o` — the model previously hardcoded in runAgent/llm.ts. */
  model?: string;
  /** Default sampling temperature when a call doesn't override it. */
  temperature?: number;
}

export class OpenAILLMProvider implements LLMProvider {
  private readonly model: string;
  private readonly defaultTemperature: number;

  constructor(options: OpenAILLMProviderOptions = {}) {
    this.model = options.model ?? 'gpt-4o';
    this.defaultTemperature = options.temperature ?? 0.1;
  }

  async generateStructured<T>(params: {
    prompt: string;
    schema: z.ZodType<T>;
    temperature?: number;
  }): Promise<T> {
    try {
      const result = await generateObject({
        model: openai(this.model),
        schema: params.schema,
        prompt: params.prompt,
        temperature: params.temperature ?? this.defaultTemperature,
      });
      // result.object is already validated against the schema.
      return result.object;
    } catch (error) {
      console.error(`Error calling external LLM (${this.model}) for Agent Runtime:`, error);
      throw new Error('External LLM call failed to produce a structured response.');
    }
  }
}
