/**
 * Switch the team into autonomous mode for an extended sprint.
 *
 * Idempotent. Run any time you want to bump caps + apply per-agent git
 * identity to existing worktrees + send a heads-up to the PM:
 *
 *   corepack pnpm --filter @agentboard/orchestrator exec tsx ../../scripts/scale_autonomous.ts
 *
 * Effects:
 *   1. Bumps cost caps on every agent (daily $100, lifetime $500/agent).
 *   2. For every agent that already has a worktree, sets git
 *      `user.name`/`user.email` to the agent's name so commits land
 *      attributed to them.
 *   3. Inserts a one-shot broadcast in the PM's inbox saying
 *      "autonomous mode: you can merge PRs, no human approval required."
 */
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { db } from '../apps/orchestrator/src/db/client.js';
import { agents, messages } from '../apps/orchestrator/src/db/schema.js';
import { enqueueDispatch } from '../apps/orchestrator/src/redis/streams.js';
import { logger } from '../apps/orchestrator/src/logger.js';

const execFile = promisify(execFileCb);

async function gitConfig(cwd: string, key: string, value: string) {
  try {
    await execFile('git', ['config', key, value], { cwd });
  } catch (err) {
    logger.warn({ err, cwd, key }, 'git config failed (non-fatal)');
  }
}

async function main() {
  logger.info('Switching team to autonomous mode…');

  /* 1) caps — generous-but-bounded */
  const DAILY = 100_000_000; // $100/day per agent
  const TOTAL = 500_000_000; // $500/agent for the sprint
  const updated = await db
    .update(agents)
    .set({ dailyCostCapMicroUsd: DAILY, totalCostCapMicroUsd: TOTAL })
    .returning({ id: agents.id, name: agents.name });
  logger.info({ count: updated.length, daily: '$100', total: '$500' }, 'Cost caps bumped');

  /* 2) per-agent git identity in existing worktrees */
  const all = await db.select().from(agents);
  for (const a of all) {
    if (!a.worktreePath) continue;
    await gitConfig(a.worktreePath, 'user.name', a.name);
    await gitConfig(a.worktreePath, 'user.email', `${a.name}@agentboard.local`);
    logger.info({ agent: a.name, worktree: a.worktreePath }, 'Git identity applied');
  }

  /* 3) PM heads-up */
  const [alice] = await db.select().from(agents).where(eq(agents.role, 'pm')).limit(1);
  if (alice) {
    await db.insert(messages).values({
      fromAgentId: null,
      toAgentId: alice.id,
      type: 'broadcast',
      subject: 'Autonomous mode: ship without waiting',
      content: `Stakeholder explicitly opted in to autonomous mode. Updates:

- Cost caps bumped to **$100/day, $500 lifetime per agent**.
- Each agent's git identity is now their own name (commits attributed
  to alice-pm, lucas-frontend, etc).
- The merge-to-main guardrail is RELAXED:
  - \`gh pr merge\` is allowed.
  - You no longer need to call \`request_approval\` before merging.
  - Direct \`git push origin main\` is still blocked — keep using PRs.
- You drive merges. Process per task: review on the PR, request changes
  if needed, merge when reviewer + checks are green, move the task to
  done.

What "ready to merge" means in this mode:
1. The implementer pushed their branch.
2. They called \`request_review\` to whoever owns the area
   (cybersec for auth, cto for architecture, qa for tests, you for PM
   work).
3. The reviewer left findings; the implementer addressed them or
   recorded a decision.
4. You confirm CI is green (\`gh pr checks <number>\`).
5. You merge with \`gh pr merge --squash --delete-branch <number>\`.

No need to wait for the stakeholder. Optimize for shipping clean,
small PRs in series — quality > volume.`,
      deliveredAt: new Date(),
    });
    try {
      await enqueueDispatch(alice.id);
    } catch (err) {
      logger.warn({ err }, 'enqueueDispatch for alice failed (non-fatal)');
    }
    logger.info('PM notified about autonomous mode');
  }

  logger.info('Done.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.fatal({ err }, 'scale_autonomous failed');
    process.exit(1);
  });
