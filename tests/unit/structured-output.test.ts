import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseStructuredOutput } from '../../src/worker/ai/structured-output';

const schema = z.object({ status: z.literal('ok') }).strict();

describe('Workers AI structured response formats', () => {
  it.each([{ status: 'ok' }, '{"status":"ok"}'])(
    'accepts the live parsed response and the JSON string format: %j',
    (response) => {
      expect(parseStructuredOutput(schema, response)).toEqual({ status: 'ok' });
    },
  );

  it.each([undefined, null, 'not JSON', { status: 'wrong' }, { status: 'ok', extra: true }])(
    'rejects missing, malformed or schema-invalid content: %j',
    (response) => {
      expect(() => parseStructuredOutput(schema, response)).toThrow();
    },
  );
});
