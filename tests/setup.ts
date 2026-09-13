import { beforeAll } from 'vitest';
import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { z } from 'zod';
const migrationSchema = z.array(z.object({ name: z.string(), queries: z.array(z.string()) }));
beforeAll(async () => {
  await applyD1Migrations(env.DB, migrationSchema.parse(Reflect.get(env, 'TEST_MIGRATIONS')));
});
