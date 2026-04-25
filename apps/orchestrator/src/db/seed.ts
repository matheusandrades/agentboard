import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import {
  AGENT_ROLES,
  DEFAULT_EFFORT,
  DEFAULT_MAX_TURNS,
  DEFAULT_MODEL,
  type AgentRole,
} from '@agentboard/shared';
import { db, closeDb } from './client.js';
import { agents, sprints } from './schema.js';
import { paths } from '../config.js';
import { logger } from '../logger.js';

const __filename = fileURLToPath(import.meta.url);

/**
 * Idempotent seed: creates the 8 default agents + 1 demo sprint if they don't
 * yet exist. Runs against the connection pool exposed by `client.ts`.
 */
export async function seed(): Promise<void> {
  logger.info('Seeding database…');

  const roleEntries = Object.entries(AGENT_ROLES) as [AgentRole, { defaultName: string; title: string }][];

  for (const [role, info] of roleEntries) {
    const existing = await db.select().from(agents).where(eq(agents.name, info.defaultName));
    if (existing.length > 0) {
      logger.info({ role, name: info.defaultName }, 'Agent already seeded, skipping');
      continue;
    }

    const personaPath = path.join(paths.personasDir, `${role}.md`);
    await db.insert(agents).values({
      name: info.defaultName,
      role,
      personaPath,
      status: 'idle',
      model: DEFAULT_MODEL,
      maxTurns: DEFAULT_MAX_TURNS,
      extendedThinking: DEFAULT_EFFORT,
    });
    logger.info({ role, name: info.defaultName, personaPath }, 'Created agent');
  }

  const sprintName = 'Sprint 1 — MVP';
  const existingSprints = await db.select().from(sprints).where(eq(sprints.name, sprintName));
  if (existingSprints.length === 0) {
    await db.insert(sprints).values({
      name: sprintName,
      goal: 'Bootstrap the AgentBoard demo: multi-agent collaboration end-to-end.',
      status: 'active',
      startedAt: new Date(),
    });
    logger.info({ name: sprintName }, 'Created demo sprint');
  } else {
    logger.info({ name: sprintName }, 'Demo sprint already seeded, skipping');
  }

  logger.info('Seed complete');
}

// Direct-run guard
const isDirectRun = (() => {
  try {
    return path.resolve(process.argv[1] ?? '') === __filename;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  seed()
    .then(async () => {
      await closeDb();
      process.exit(0);
    })
    .catch(async (err) => {
      logger.error({ err }, 'Seed failed');
      await closeDb().catch(() => {});
      process.exit(1);
    });
}
