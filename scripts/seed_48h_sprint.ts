/**
 * One-shot seed for the "48h polish sprint".
 *
 * Run from the repo root with:
 *   corepack pnpm --filter @agentboard/orchestrator exec tsx ../../scripts/seed_48h_sprint.ts
 *
 * Effects:
 *   1. Creates a sprint named "48h polish sprint".
 *   2. Creates ~10 concrete, scoped tasks (assigned to specific roles).
 *   3. Sets daily/total cost caps on every agent so a runaway loop
 *      can't burn the operator's subscription / API spend.
 *   4. Inserts a kickoff message in alice-pm's inbox describing the
 *      sprint + the task list, and enqueues a dispatch so she runs
 *      her first turn immediately.
 *
 * Idempotent on the sprint name: if you re-run this, the sprint is
 * NOT duplicated, but the tasks ARE. Disconnect the sprint first or
 * clean up manually if you re-seed.
 */
import { eq } from 'drizzle-orm';
import { db } from '../apps/orchestrator/src/db/client.js';
import {
  agents,
  messages,
  sprints,
  tasks,
  type AgentRow,
} from '../apps/orchestrator/src/db/schema.js';
import { enqueueDispatch } from '../apps/orchestrator/src/redis/streams.js';
import { logger } from '../apps/orchestrator/src/logger.js';

interface TaskSeed {
  title: string;
  description: string;
  assigneeRole: string;
  priority: 1 | 2 | 3 | 4 | 5;
}

const TASKS: TaskSeed[] = [
  {
    title: 'Test coverage: MCP tools',
    assigneeRole: 'qa',
    priority: 2,
    description: `Add vitest coverage for the MCP tools that don't have tests yet:
ask_agent, request_review, request_approval, record_decision, list_agents,
read_inbox, launch_preview, stop_preview, open_pr, commit_code.

Acceptance:
- Each tool has at least one happy-path and one error-path test
- Mocks follow the pattern in src/mcp/tools/create_task.test.ts
- pnpm test stays green
- One PR per tool group OR one combined PR — your call

Out of scope: integration / Redis / DB tests — keep them unit-level.`,
  },
  {
    title: 'Refactor: split runner.ts into smaller modules',
    assigneeRole: 'backend',
    priority: 3,
    description: `apps/orchestrator/src/agents/runner.ts is ~500 lines and growing.
Split into:
  runner.ts                — orchestration (pickAgent, runAgentTurn, lifecycle)
  runner/prompt.ts         — buildPrompt + formatInboxAsPrompt
  runner/usage.ts          — extractUsage + recordUsageEvent
  runner/recovery.ts       — stale-session detection + auto-clear

Acceptance:
- runner.ts < 250 lines
- All existing tests pass without changes (no public API moves)
- No new dependencies
- One PR

Coordinate with cybersec (Sage) before merging — anything touching the
auth or guardrails path needs his review.`,
  },
  {
    title: 'Polish: keyboard nav on the file tree',
    assigneeRole: 'frontend',
    priority: 4,
    description: `apps/web/src/components/FileBrowser.tsx — make the tree
keyboard-navigable.

Acceptance:
- Arrow up/down moves selection
- Right arrow expands a folder, left collapses
- Enter opens the file (same as click)
- Cmd+P quick open already works — don't break it

Use roving tabindex, not real tab stops. Coordinate with uma-uiux on
focus styles.`,
  },
  {
    title: 'Polish: file viewer breadcrumb gets a "Copy path" button',
    assigneeRole: 'frontend',
    priority: 5,
    description: `Tiny UX win — clicking a button next to the breadcrumb
copies the file path to clipboard. Show a "Copied" toast for 1.2s.
Reuses the same pattern as the URL chip in /previews.`,
  },
  {
    title: 'Empty-state audit across the web app',
    assigneeRole: 'ui-ux',
    priority: 4,
    description: `Walk every page and confirm each has a clear empty state
with: a title, a one-line copy explaining what triggers content, and
(when relevant) a CTA. Pages to audit: /dashboard, /live, /board,
/agents, /projects, /orgs, /previews, /commits, /timeline, /usage,
/approvals, /settings.

Deliverable: a markdown report listing each page + current empty state
+ proposed copy. Open as a PR adding docs/ux/empty-states-audit.md;
DON'T edit the components in this task — that's a follow-up.`,
  },
  {
    title: 'Backend: GET /api/health/deep',
    assigneeRole: 'backend',
    priority: 3,
    description: `New endpoint that pings:
  - Postgres (SELECT 1, returns latency in ms)
  - Redis (PING, returns latency in ms)
  - Claude SDK (no network call — just resolve the binary, returns version)
  - GitHub mode (read-only — current connection mode + login)

Returns a JSON object with each subsystem's status and latency.

Acceptance:
- Returns 200 even when subsystems are down (so monitoring distinguishes
  "service up but redis down" from "service down")
- Each subsystem timeout = 2s
- Add a small vitest covering the OK case
- Public route (no auth required)`,
  },
  {
    title: 'DX: pnpm db:reset should also clear Redis streams',
    assigneeRole: 'dba',
    priority: 5,
    description: `Currently pnpm db:reset wipes Postgres and re-seeds, but
the Redis dispatch streams keep their state. After a reset the consumer
groups remember offsets that don't apply to the freshly-seeded agents
and the first 1-2 dispatches misfire.

Fix:
- In package.json scripts.db:reset, add a step that connects to Redis
  and DELs the agentboard:dispatch stream + all consumer groups
- OR add a helper script scripts/redis_reset.ts and chain it

Verify by running db:reset twice in a row and confirming alice picks
up the kickoff message on the first dispatch.`,
  },
  {
    title: 'Docs: per-MCP-tool reference page',
    assigneeRole: 'lang-specialist',
    priority: 4,
    description: `Write docs/tools.md — a one-page reference for every MCP
tool an agent has access to. For each tool, list:
  - Name
  - One-line purpose
  - Required and optional args
  - Side effects (DB rows? events? messages?)
  - When to use it (example scenario)
  - When NOT to use it

Source of truth: apps/orchestrator/src/mcp/tools/*.ts.

Aim for clarity over completeness — agents will read this; humans will
too. ~80 words per tool.`,
  },
  {
    title: 'Security review: auth + setup flow',
    assigneeRole: 'cybersec',
    priority: 2,
    description: `Read the entire flow end-to-end:
  - apps/orchestrator/src/auth/{password,sessions,middleware}.ts
  - apps/orchestrator/src/api/auth.ts (setup, login, password change, user CRUD)
  - apps/web/src/components/{SetupWizard,LoginPage,AuthGate,PostSetupWizard}.tsx
  - apps/web/src/pages/Users.tsx

Look for: timing attacks, session fixation, missing rate limits,
weak password policies, IDOR (admin acting on themselves), missing
CSRF on cookie-auth flows, secret leakage in error messages.

Deliverable: a markdown report at docs/security/auth-review.md with
findings (severity + file:line + recommendation).
DO NOT patch the issues in this task — that's a follow-up after the
PM triages your findings.`,
  },
  {
    title: 'Architecture: write up the dispatcher',
    assigneeRole: 'cto',
    priority: 4,
    description: `One-page deep dive at docs/architecture/dispatcher.md
covering:
  - The Redis stream + consumer group model
  - Ack-before-process invariant (and why)
  - Reclaim path (XAUTOCLAIM) for crashed orchestrators
  - Per-agent dedup + sliding window loop detection
  - Graceful shutdown semantics

Include a sequence diagram (mermaid is fine — it renders in GitHub).
This is for future maintainers, including future-you.`,
  },
];

/* ------------------------------ run ----------------------------- */

async function main() {
  logger.info('Seeding 48h polish sprint…');

  const allAgents = await db.select().from(agents);
  if (allAgents.length === 0) {
    throw new Error('No agents in the DB — run pnpm db:seed first.');
  }
  const byRole = new Map<string, AgentRow>();
  for (const a of allAgents) byRole.set(a.role, a);

  /* 1) sprint */
  const sprintName = '48h polish sprint';
  const existing = await db.select().from(sprints).where(eq(sprints.name, sprintName)).limit(1);
  let sprintId: string;
  if (existing.length > 0) {
    sprintId = existing[0]!.id;
    logger.warn({ sprintId }, 'Sprint already exists — reusing it');
  } else {
    const [created] = await db
      .insert(sprints)
      .values({
        name: sprintName,
        goal:
          'Polish AgentBoard end-to-end: tests, refactors, docs, accessibility, security review. No new features.',
        status: 'active',
        startedAt: new Date(),
        endsAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      })
      .returning();
    if (!created) throw new Error('Sprint creation failed');
    sprintId = created.id;
    logger.info({ sprintId }, 'Sprint created');
  }

  /* 2) cost caps — generous-but-bounded */
  const DAILY_CAP_MICRO_USD = 25_000_000; // $25/day per agent
  const TOTAL_CAP_MICRO_USD = 100_000_000; // $100 lifetime cap per agent for the sprint
  for (const a of allAgents) {
    await db
      .update(agents)
      .set({
        dailyCostCapMicroUsd: DAILY_CAP_MICRO_USD,
        totalCostCapMicroUsd: TOTAL_CAP_MICRO_USD,
      })
      .where(eq(agents.id, a.id));
  }
  logger.info({ count: allAgents.length, daily: '$25', total: '$100' }, 'Cost caps applied');

  /* 3) tasks */
  const taskRows = [];
  for (const seed of TASKS) {
    const assignee = byRole.get(seed.assigneeRole);
    if (!assignee) {
      logger.warn({ role: seed.assigneeRole }, 'No agent for role — skipping task');
      continue;
    }
    const [t] = await db
      .insert(tasks)
      .values({
        title: seed.title,
        description: seed.description,
        status: 'todo',
        assigneeId: assignee.id,
        priority: seed.priority,
        sprintId,
      })
      .returning();
    if (t) {
      taskRows.push({ task: t, assignee });
      logger.info({ task: t.title, role: seed.assigneeRole }, 'Task created');
    }
  }

  /* 4) per-task assignment messages — these wake each specialist */
  for (const { task, assignee } of taskRows) {
    await db.insert(messages).values({
      fromAgentId: null,
      toAgentId: assignee.id,
      type: 'assignment',
      subject: `New task: ${task.title}`,
      content: `You've been assigned a task in the **48h polish sprint**.

**${task.title}**
Priority: P${task.priority}
Status: ${task.status}
Task ID: ${task.id}

${task.description}

When you finish, commit on a per-task branch (\`agent/${assignee.name}/task-${task.id.slice(0, 8)}\`),
push, and call \`open_pr\`. Notify alice-pm with a status update.`,
      taskId: task.id,
      deliveredAt: new Date(),
    });
    try {
      await enqueueDispatch(assignee.id);
    } catch (err) {
      logger.warn({ err, agentId: assignee.id }, 'enqueueDispatch failed');
    }
  }

  /* 5) kickoff message to PM */
  const alice = byRole.get('pm');
  if (alice) {
    const taskListBlock = taskRows
      .map(({ task, assignee }) => `  - **${task.title}** → ${assignee.name} (P${task.priority})`)
      .join('\n');
    await db.insert(messages).values({
      fromAgentId: null,
      toAgentId: alice.id,
      type: 'broadcast',
      subject: '48h polish sprint — kickoff',
      content: `Stakeholder is offline for the next 48h. Run a focused polish sprint.

**Sprint goal**
Polish AgentBoard end-to-end. No new features. Each task is bounded,
review-able as a single PR.

**Tasks already on the board (assigned to specialists):**

${taskListBlock}

**Your job**
- Coordinate, don't code. You're the PM.
- Each agent has the full task description in their inbox already.
- When someone reports they're done, request a review from the right
  reviewer (cybersec for auth-adjacent, cto for architecture/refactors,
  qa for tests).
- DO NOT merge anything to main yourself — that's gated by the
  PreToolUse hook anyway. Tag the stakeholder via \`request_approval\`
  for any PR you'd like merged.
- If an agent is stuck, unblock them in minutes, not hours.
- Daily check-in: post a one-line summary of what's in flight and what's
  blocked.

**Hard limits** (already enforced)
- Cost cap: $25/day per agent, $100 lifetime per agent for the sprint.
- A runaway loop will be killed by the existing detection.
- Sessions auto-recover from stale Claude Code session ids.

**On the stakeholder's return**
They'll triage open PRs and either merge or request changes. They will
NOT want to read 40 half-done branches. Quality > quantity.

Begin.`,
      deliveredAt: new Date(),
    });
    try {
      await enqueueDispatch(alice.id);
      logger.info('Alice woken up — sprint is live');
    } catch (err) {
      logger.warn({ err }, 'enqueueDispatch failed for alice');
    }
  } else {
    logger.warn('No PM agent found — kickoff message skipped');
  }

  logger.info('Seed complete.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.fatal({ err }, 'seed_48h_sprint failed');
    process.exit(1);
  });
