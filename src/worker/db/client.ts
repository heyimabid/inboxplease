import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';
import type { Env } from '../env';
export const database = (env: Env) => drizzle(env.DB, { schema });
export type Database = ReturnType<typeof database>;
