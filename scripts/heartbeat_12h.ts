/**
 * Heartbeat for the 12-hour continuous sprint.
 *
 * Runs as a long-lived process (start under PM2). Every 30 minutes:
 *   - Inserts a 'status check' message in alice-pm's inbox.
 *   - Wakes alice via enqueueDispatch.
 *   - Counts the cycle. After 24 cycles (12h), exits cleanly.
 *
 * Usage:
 *   npx pm2 start --name agentboard-heartbeat \
 *     --no-autorestart \
 *     "corepack pnpm --filter @agentboard/orchestrator exec tsx ../../scripts/heartbeat_12h.ts"
 */
import { eq } from 'drizzle-orm';
import { db } from '../apps/orchestrator/src/db/client.js';
import { agents, messages } from '../apps/orchestrator/src/db/schema.js';
import { enqueueDispatch } from '../apps/orchestrator/src/redis/streams.js';
import { logger } from '../apps/orchestrator/src/logger.js';

const INTERVAL_MS = 60 * 60 * 1000; // 60 min — earlier 30 min was too noisy
const TOTAL_CYCLES = 12; // 12 × 60 min = 12 h

const STATUS_CHECK_BODY = (cycle: number, remaining: number) =>
  `**Status check (heartbeat ${cycle}/${TOTAL_CYCLES} — ${(remaining * 30) / 60} h left in the sprint).**

Right now, in one pass:
1. Quote the *current* state in one line: who's coding what, who's reviewing what, what merged this last 30 min.
2. List anyone waiting > 15 min for a reply / review / approval. Unblock them in this turn.
3. Look at \`/board\`. Anything in \`todo\` with no assignee? Assign it. Anything in \`review\` for > 1 hour? Push the reviewer.
4. Pick up the next backlog item if the team has spare cycles.
5. If a tool call has been blocked by guardrails (sensitive path, outbound HTTP, etc.) since the last heartbeat, summarise via \`record_decision\` so the stakeholder sees it on return.

After this turn, your next assignment-driven message resumes the normal flow. Keep moving.`;

async function main() {
  const [pm] = await db.select().from(agents).where(eq(agents.role, 'pm')).limit(1);
  if (!pm) {
    logger.error('No PM agent — heartbeat exits');
    process.exit(1);
  }
  logger.info({ pm: pm.name, totalCycles: TOTAL_CYCLES }, 'Heartbeat started');

  for (let i = 1; i <= TOTAL_CYCLES; i += 1) {
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
    try {
      await db.insert(messages).values({
        fromAgentId: null,
        toAgentId: pm.id,
        type: 'broadcast',
        subject: `Heartbeat ${i}/${TOTAL_CYCLES}`,
        content: STATUS_CHECK_BODY(i, TOTAL_CYCLES - i),
        deliveredAt: new Date(),
      });
      await enqueueDispatch(pm.id);
      logger.info({ cycle: i }, 'Heartbeat fired');
    } catch (err) {
      logger.warn({ err, cycle: i }, 'Heartbeat cycle failed (will continue)');
    }
  }
  logger.info('Heartbeat sprint window finished — exiting');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.fatal({ err }, 'heartbeat crashed');
    process.exit(1);
  });
