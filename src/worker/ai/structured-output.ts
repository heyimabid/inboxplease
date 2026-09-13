import { z } from 'zod';

// Workers AI structured output can arrive as parsed JSON or a JSON string.
// Both forms must pass the same application schema before use.
export function parseStructuredOutput<T>(schema: z.ZodType<T>, response: unknown): T {
  return schema.parse(typeof response === 'string' ? JSON.parse(response) : response);
}
