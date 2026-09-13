import { z } from 'zod';
import type { Env } from '../env';
import { parseStructuredOutput } from './structured-output';
export async function geminiJson<T>(
  env: Env,
  model: string,
  schema: z.ZodType<T>,
  system: string,
  user: string,
  images: string[],
) {
  if (!env.AI_GATEWAY_ID) throw new Error('Gemini requires an AI Gateway');
  const parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] = [
    { text: user },
  ];
  for (const image of images) {
    const match = image.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new Error('Unsupported Gemini image input');
    parts.push({ inlineData: { mimeType: match[1]!, data: match[2]! } });
  }
  const response = await env.AI.gateway(env.AI_GATEWAY_ID).run(
    {
      provider: 'google-ai-studio',
      endpoint: `v1beta/models/${encodeURIComponent(model.replace(/^google\//, ''))}:generateContent`,
      headers: {
        'cf-aig-byok-alias': 'default',
        'cf-aig-skip-cache': 'true',
        'cf-aig-collect-log': 'false',
      },
      query: {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: z.toJSONSchema(schema),
          temperature: 0.1,
          maxOutputTokens: 8192,
        },
      },
    },
    { signal: AbortSignal.timeout(45000) },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Gemini gateway status ${response.status}`);
  }
  const result = z
    .object({
      candidates: z.array(
        z.object({
          finishReason: z.string(),
          content: z.object({
            parts: z.array(
              z.object({ text: z.string().optional(), thought: z.boolean().optional() }),
            ),
          }),
        }),
      ),
    })
    .parse(await response.json());
  const candidate = result.candidates[0];
  if (!candidate || candidate.finishReason !== 'STOP')
    throw new Error('Gemini response incomplete');
  return parseStructuredOutput(
    schema,
    candidate.content.parts
      .filter((p) => !p.thought)
      .map((p) => p.text ?? '')
      .join(''),
  );
}
