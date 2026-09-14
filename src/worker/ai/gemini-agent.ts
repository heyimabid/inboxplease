import { z } from 'zod';
import type { Env } from '../env';

// Preserve opaque thought signatures and model parts across every tool round.
const partSchema = z
  .object({
    text: z.string().optional(),
    thought: z.boolean().optional(),
    thoughtSignature: z.string().optional(),
    functionCall: z
      .object({
        name: z.string(),
        args: z.record(z.string(), z.unknown()).optional(),
        id: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type AgentPart = z.infer<typeof partSchema>;
export type AgentContent = { role: 'user' | 'model'; parts: AgentPart[] };
export type FunctionDeclaration = {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
};
export async function geminiAgentStep(
  env: Env,
  system: string,
  contents: AgentContent[],
  functions: FunctionDeclaration[],
  signal?: AbortSignal,
) {
  if (!env.CHAT_MODEL.startsWith('google/gemini-') || !env.AI_GATEWAY_ID)
    throw new Error('Gemini agent configuration missing');
  const model = env.CHAT_MODEL.slice('google/'.length);
  const response = await env.AI.gateway(env.AI_GATEWAY_ID).run(
    {
      provider: 'google-ai-studio',
      endpoint: `v1beta/models/${encodeURIComponent(model)}:generateContent`,
      headers: {
        'cf-aig-byok-alias': 'default',
        'cf-aig-skip-cache': 'true',
        'cf-aig-collect-log': 'false',
      },
      query: {
        systemInstruction: { parts: [{ text: system }] },
        contents,
        tools: [{ functionDeclarations: functions }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
        generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
      },
    },
    { signal: signal ?? AbortSignal.timeout(45000) },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Gemini agent HTTP ${response.status}`);
  }
  const result = z
    .object({
      candidates: z.array(
        z.object({
          finishReason: z.string(),
          content: z
            .object({ role: z.literal('model').optional(), parts: z.array(partSchema) })
            .passthrough(),
        }),
      ),
    })
    .parse(await response.json());
  const candidate = result.candidates[0];
  if (!candidate || candidate.finishReason !== 'STOP' || !candidate.content.parts.length)
    throw new Error('Incomplete Gemini agent response');
  return { role: 'model' as const, parts: candidate.content.parts };
}
