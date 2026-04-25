import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { env } from '../config.js';
import { schema } from './schema.js';

// `postgres` is the raw driver; Drizzle wraps it.
export const sql = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
});

export const db = drizzle(sql, { schema });

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}

/**
 * Small ping that tries a cheap SELECT 1; returns true on success, false on
 * failure (never throws). Used by /api/health.
 */
export async function pingDb(): Promise<boolean> {
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
