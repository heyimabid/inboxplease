import { z } from 'zod';
import type { Env } from '../env';
import { log } from '../shared/logger';
import { normalize } from '../shared/validation';
import { parseStructuredOutput } from './structured-output';
export interface Inference {
  embed(text: string): Promise<number[]>;
  json<T>(schema: z.ZodType<T>, system: string, user: string, images?: string[]): Promise<T>;
}
export function localEmbedding(text: string, dimensions: number) {
  const vector = Array.from({ length: dimensions }, () => 0);
  for (const term of normalize(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)) {
    let h = 2166136261;
    for (const c of term) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    const i = (h >>> 0) % dimensions;
    vector[i] = (vector[i] ?? 0) + 1;
  }
  const norm = Math.hypot(...vector) || 1;
  return vector.map((v) => v / norm);
}
export function cosine(a: number[], b: number[]) {
  return a.reduce((s, v, i) => s + v * (b[i] ?? 0), 0) / (Math.hypot(...a) * Math.hypot(...b) || 1);
}
export function inference(env: Env): Inference {
  return {
    async embed(text) {
      if (env.APP_MODE === 'mock') return localEmbedding(text, Number(env.EMBEDDING_DIMENSIONS));
      if (!env.EMBEDDING_MODEL.includes('/bge-'))
        throw new Error('Unsupported embedding model contract');
      const result = await env.AI.run(env.EMBEDDING_MODEL, { text: [text] });
      const parsed = z.object({ data: z.array(z.array(z.number().finite())) }).parse(result);
      const vector = parsed.data[0];
      if (!vector || vector.length !== Number(env.EMBEDDING_DIMENSIONS))
        throw new Error('Embedding dimension mismatch');
      return vector;
    },
    async json(schema, system, user, imageUrls = []) {
      if (env.APP_MODE === 'mock')
        throw new Error('Mock inference must use a deterministic feature adapter');
      const model = imageUrls.length ? env.VISION_MODEL : env.CHAT_MODEL;
      for (let attempt = 0; attempt < 2; attempt++) {
        const started = Date.now();
        try {
          const result = await env.AI.run(
            model,
            {
              messages: [
                {
                  role: 'system',
                  content:
                    system +
                    (attempt
                      ? '\nYour previous output could not be validated. Return only JSON matching the supplied schema. Use null or empty arrays for unknown facts.'
                      : ''),
                },
                {
                  role: 'user',
                  content: imageUrls.length
                    ? [
                        { type: 'text', text: user },
                        ...imageUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
                      ]
                    : user,
                },
              ],
              response_format: { type: 'json_schema', json_schema: z.toJSONSchema(schema) },
              temperature: 0.1,
              max_tokens: 1800,
            },
            env.AI_GATEWAY_ID
              ? { gateway: { id: env.AI_GATEWAY_ID, skipCache: true, collectLog: false } }
              : undefined,
          );
          const output = z
            .object({
              response: z.unknown(),
              usage: z
                .object({
                  prompt_tokens: z.number().optional(),
                  completion_tokens: z.number().optional(),
                })
                .optional(),
            })
            .parse(result);
          const parsed = parseStructuredOutput(schema, output.response);
          log('ai_inference', {
            model,
            latencyMs: Date.now() - started,
            retryCount: attempt,
            inputTokens: output.usage?.prompt_tokens,
            outputTokens: output.usage?.completion_tokens,
          });
          return parsed;
        } catch {
          log('ai_invalid_output', { model, retryCount: attempt, errorCategory: 'model_contract' });
        }
      }
      throw new Error('Model output failed validation');
    },
  };
}
