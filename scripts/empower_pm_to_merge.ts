/**
 * Drop a follow-up in alice's inbox: "you have full merge authority,
 * stop waiting for the stakeholder, here are the open PRs, action now."
 */
import { eq } from 'drizzle-orm';
import { db } from '../apps/orchestrator/src/db/client.js';
import { agents, messages } from '../apps/orchestrator/src/db/schema.js';
import { enqueueDispatch } from '../apps/orchestrator/src/redis/streams.js';
import { logger } from '../apps/orchestrator/src/logger.js';

const SUBJECT = 'You have full merge authority — stop waiting';
const BODY = `Stakeholder: explicit confirmation. **You can merge to \`main\` yourself. Do not wait.**

The flow you must follow:
  1. Implementer pushes to \`agent/<name>/task-<id>\` (allowed).
  2. Implementer opens a PR via \`open_pr\` (allowed).
  3. You assign a reviewer with \`request_review\`. Reviewer reads the
     diff, comments / approves on the PR.
  4. When CI is green and the reviewer is happy, **you (the PM) run
     \`gh pr merge --squash --delete-branch <number>\` from your
     worktree**. That command is allowed. The hook only blocks direct
     \`git push origin main\`, not \`gh pr merge\`.
  5. \`update_task\` to mark the task done.
  6. Pick the next task.

You **never** \`request_approval\` from the stakeholder for routine
merges. That tool is reserved for things like:
  - A new public route or API endpoint that exposes data.
  - A schema migration that touches PII or auth.
  - Removing a security guardrail.
  - Anything truly destructive that the team can't reverse.

Routine code review + merge: that is YOUR call.

## Right now

There are 5 PRs sitting open from overnight. Triage in this order:

  - **#5** dani-dba — \`fix(dx): pnpm db:reset clears Redis state\`
      Risk: low. Reviewer: bruno-backend (worktree-touching code).
      Merge target: today.
  - **#3** carl-cto — \`docs(architecture): dispatcher deep dive\`
      Risk: zero (docs). Reviewer: anyone — or skip review and merge.
  - **#4** carl-cto — \`docs(adr): defer i18n\`
      Risk: zero (docs). Same as #3.
  - **#2** leo-langs — \`docs: per-MCP-tool reference\`
      Risk: zero. Quick review for accuracy by anyone touching MCP
      (sage / bruno / lucas) and merge.
  - **#1** leo-langs — \`docs: team style guide\`
      Risk: zero. Same as #2.

For each PR:
  - Run \`gh pr checks <number>\` — confirm green.
  - Run \`gh pr view <number>\` — read the diff summary.
  - Either merge directly (docs PRs with no controversy) or
    \`request_review\` first.

When you finish triaging the 5, pick up the next P2/P3 task on the
board. The team should not be sitting at red lights — keep work moving.

Stop asking. Merge.`;

async function main() {
  const [pm] = await db.select().from(agents).where(eq(agents.role, 'pm')).limit(1);
  if (!pm) {
    logger.error('No PM agent — abort');
    process.exit(1);
  }
  await db.insert(messages).values({
    fromAgentId: null,
    toAgentId: pm.id,
    type: 'broadcast',
    subject: SUBJECT,
    content: BODY,
    deliveredAt: new Date(),
  });
  await enqueueDispatch(pm.id);
  logger.info({ pm: pm.name }, 'Merge-authority briefing delivered');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.fatal({ err }, 'failed');
    process.exit(1);
  });
