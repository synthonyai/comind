/**
 * OpenAILLMProvider — an LLMProvider over OpenAI via the Vercel AI SDK. Fills
 * the schema CoMind passes in (`generateStructured`) and streams replies
 * (`streamText`). The model lives HERE, not on the interface; `models` can route
 * individual jobs to different models.
 */

import { openai } from '@ai-sdk/openai';
import { generateObject, streamText } from 'ai';
import type { z } from 'zod';
import type { ChatMessage, LLMJob, LLMProvider } from '@/lib/comind/providers';

export interface OpenAILLMProviderOptions {
  /** Default model for every job. Defaults to `gpt-4o`. */
  model?: string;
  /** Per-job overrides, e.g. `{ extraction: 'gpt-4o-mini' }`. */
  models?: Partial<Record<LLMJob, string>>;
  /** Default sampling temperature when a call doesn't override it. */
  temperature?: number;
}

export class OpenAILLMProvider implements LLMProvider {
  private readonly model: string;
  private readonly models: Partial<Record<LLMJob, string>>;
  private readonly defaultTemperature: number;

  constructor(options: OpenAILLMProviderOptions = {}) {
    this.model = options.model ?? 'gpt-4o';
    this.models = options.models ?? {};
    this.defaultTemperature = options.temperature ?? 0.1;
  }

  private modelFor(job: LLMJob): string {
    return this.models[job] ?? this.model;
  }

  async generateStructured<T>(params: {
    job: LLMJob;
    prompt: string;
    schema: z.ZodType<T>;
    temperature?: number;
  }): Promise<T> {
    const model = this.modelFor(params.job);
    try {
      const result = await generateObject({
        model: openai(model),
        schema: params.schema,
        prompt: params.prompt,
        temperature: params.temperature ?? this.defaultTemperature,
      });
      // result.object is already validated against the schema.
      return result.object;
    } catch (error) {
      console.error(`CoMind: ${params.job} call to ${model} failed:`, error);
      throw new Error(`CoMind: the ${params.job} call failed to produce a structured response.`);
    }
  }

  async *streamText(params: {
    job: LLMJob;
    system: string;
    messages: ChatMessage[];
    temperature?: number;
  }): AsyncIterable<string> {
    const result = streamText({
      model: openai(this.modelFor(params.job)),
      system: params.system,
      messages: params.messages,
      temperature: params.temperature ?? this.defaultTemperature,
    });
    yield* result.textStream;
  }
}
