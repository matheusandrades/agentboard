/**
 * Hand alice a precise, action-only directive: merge the open PRs whose
 * checks are green, with the exact commands. No PM debate, no waiting.
 *
 * Pulls the list of mergeable open PRs at run time so the message is
 * always current.
 */
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { db } from '../apps/orchestrator/src/db/client.js';
import { agents, messages } from '../apps/orchestrator/src/db/schema.js';
import { enqueueDispatch } from '../apps/orchestrator/src/redis/streams.js';
import { logger } from '../apps/orchestrator/src/logger.js';

const execFile = promisify(execFileCb);

interface OpenPr {
  number: number;
  title: string;
  headRefName: string;
  statusCheckRollup: Array<{ conclusion?: string; status?: string }>;
}

async function listOpenMergeable(): Promise<OpenPr[]> {
  const { stdout } = await execFile('gh', [
    'pr',
    'list',
    '--state',
    'open',
    '--limit',
    '30',
    '--json',
    'number,title,headRefName,statusCheckRollup',
  ]);
  const all = JSON.parse(stdout) as OpenPr[];
  return all.filter((p) => {
    const checks = p.statusCheckRollup ?? [];
    if (checks.length === 0) return true; // no checks configured
    return checks.every((c) => c.conclusion === 'SUCCESS' || c.status === 'COMPLETED');
  });
}

async function main() {
  const [pm] = await db.select().from(agents).where(eq(agents.role, 'pm')).limit(1);
  if (!pm) {
    logger.error('No PM — abort');
    process.exit(1);
  }

  const prs = await listOpenMergeable();
  if (prs.length === 0) {
    logger.info('No mergeable open PRs right now — nothing to do');
    process.exit(0);
  }

  const lines = prs
    .map(
      (p) =>
        `**#${p.number}** — ${p.title}\n  \`gh pr merge --squash --delete-branch ${p.number}\``,
    )
    .join('\n\n');

  const body = `**Action only — no debate.** The stakeholder is doing manual merges right now because you stopped doing them. Resume.

You have full \`gh pr merge\` authority. Pre-flight checked: each PR below has green CI. Run these commands in your worktree this turn, in order:

${lines}

After every \`gh pr merge\` succeeds, the \`pr_sync\` background worker (just deployed) will move the matching task to \`done\` within 60 seconds. You don't have to call \`update_task\` for these — just merge.

Once the queue is empty, look at the rest of the in-flight tasks (24 of them) and **ping each assignee** to push their branch + open the PR if they haven't yet. Anyone with code committed for > 30 min and no PR open is the bottleneck.

Then pick the next backlog item.

Don't ask for confirmation. Don't request_approval. **Merge now.**`;

  await db.insert(messages).values({
    fromAgentId: null,
    toAgentId: pm.id,
    type: 'broadcast',
    subject: `Merge ${prs.length} PR${prs.length === 1 ? '' : 's'} now`,
    content: body,
    deliveredAt: new Date(),
  });
  await enqueueDispatch(pm.id);
  logger.info({ pm: pm.name, prs: prs.map((p) => p.number) }, 'Merge directive delivered');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.fatal({ err }, 'merge_now failed');
    process.exit(1);
  });
