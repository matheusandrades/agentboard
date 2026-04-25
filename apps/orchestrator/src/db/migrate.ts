import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { env } from '../config.js';
import { logger } from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(): Promise<void> {
  const migrationsFolder = path.resolve(__dirname, '..', '..', 'drizzle');

  // If no migrations folder exists yet (fresh repo), skip — `drizzle-kit push`
  // from the `db:migrate` npm script will have already applied the schema.
  try {
    await fs.access(migrationsFolder);
  } catch {
    logger.info({ migrationsFolder }, 'No migrations folder; skipping migrator');
    return;
  }

  // Standalone connection (not the app pool).
  const client = postgres(env.DATABASE_URL, { max: 1, prepare: false });
  const drizzleClient = drizzle(client);
  try {
    logger.info({ migrationsFolder }, 'Running Drizzle migrations');
    await migrate(drizzleClient, { migrationsFolder });
    logger.info('Migrations complete');
  } finally {
    await client.end({ timeout: 5 });
  }
}

// When invoked directly via `tsx src/db/migrate.ts`.
const isDirectRun = (() => {
  try {
    return path.resolve(process.argv[1] ?? '') === __filename;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'Migration failed');
      process.exit(1);
    });
}
