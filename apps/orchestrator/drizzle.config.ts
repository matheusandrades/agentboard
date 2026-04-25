import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'node:path';
import { defineConfig } from 'drizzle-kit';

// Load .env from the monorepo root regardless of where drizzle-kit is invoked.
dotenvConfig({ path: resolve(process.cwd(), '../../.env') });
dotenvConfig(); // local fallback (apps/orchestrator/.env) if present

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://agentboard:agentboard@localhost:55432/agentboard',
  },
  strict: true,
  verbose: true,
});
