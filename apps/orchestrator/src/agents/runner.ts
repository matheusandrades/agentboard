import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { db } from '../db/client.js';
import {
  agents,
  commits,
  messages,
  projects,
  tasks,
  usageEvents,
  type AgentRow,
  type MessageRow,
} from '../db/schema.js';
import { computeCostMicroUsd, extractUsage } from '../lib/pricing.js';
import { checkBudget } from '../lib/budget.js';
import { audit } from '../lib/audit.js';
import { buildSystemPrompt } from './persona.js';
import { buildMcpServer, AGENT_ALLOWED_TOOLS } from '../mcp/server.js';
import { activityHook } from '../hooks/activity.js';
import { sessionHook } from '../hooks/session.js';
import { guardrailsHook } from '../hooks/guardrails.js';
import { eventBus } from '../events/bus.js';
import { createWorktree, readWorktreeCommits } from '../worktree/manager.js';
import { cloneRepo, ensureBranch } from '../github/client.js';
import { enqueueDispatch } from '../redis/streams.js';
import { env } from '../config.js';
import { logger } from '../logger.js';
import {
  DEFAULT_EFFORT,
  DEFAULT_MAX_TURNS,
  DEFAULT_MODEL,
  type AgentEffort,
  type AgentModel,
  type AgentStatus,
} from '@agentboard/shared';

/**
 * Format a batch of unread messages as a single prompt for the agent.
 * Each message becomes a block with who, type, subject, and body.
 */
export function formatInboxAsPrompt(batch: MessageRow[], senderNameById: Map<string, string>): string {
  if (batch.length === 0) return '';
  const lines: string[] = [];
  lines.push(
    `You have ${batch.length} new message${batch.length === 1 ? '' : 's'} in your inbox. Read them and act accordingly (respond, create tasks, commit code, etc.).`,
  );
  lines.push('');
  batch.forEach((m, i) => {
    const from = m.fromAgentId ? senderNameById.get(m.fromAgentId) ?? m.fromAgentId : 'stakeholder';
    lines.push(`─── Message ${i + 1} / ${batch.length} ───`);
    lines.push(`From: ${from}`);
    lines.push(`Type: ${m.type}`);
    if (m.subject) lines.push(`Subject: ${m.subject}`);
    if (m.taskId) lines.push(`Task: ${m.taskId}`);
    if (m.threadId) lines.push(`Thread: ${m.threadId}`);
    lines.push('');
    lines.push(m.content);
    lines.push('');
  });
  lines.push('End of inbox.');
  return lines.join('\n');
}

async function setAgentStatus(agentId: string, status: AgentStatus): Promise<void> {
  await db.update(agents).set({ status }).where(eq(agents.id, agentId));
  await eventBus.emit({
    type: 'agent.status',
    agentId,
    status,
    at: new Date().toISOString(),
  });
}

async function getUnreadMessages(agentId: string, limit = 20): Promise<MessageRow[]> {
  return db
    .select()
    .from(messages)
    .where(and(eq(messages.toAgentId, agentId), isNull(messages.readAt)))
    .orderBy(asc(messages.createdAt))
    .limit(limit);
}

async function markMessagesRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.update(messages).set({ readAt: new Date() }).where(inArray(messages.id, ids));
}

/**
 * Scan the agent's worktree for commits that aren't in the DB yet and
 * import them. Catches commits made via raw `Bash: git commit` (not the
 * commit_code MCP tool). Emits a UI event per new commit so /commits and
 * /live update live. Best-effort: logs and swallows errors.
 */
async function syncAgentCommits(
  agentId: string,
  worktreePath: string | null,
  taskId: string | null = null,
): Promise<void> {
  if (!worktreePath) return;
  try {
    const rows = await readWorktreeCommits(worktreePath, 50);
    if (rows.length === 0) return;

    const existing = await db
      .select({ sha: commits.sha })
      .from(commits)
      .where(eq(commits.agentId, agentId));
    const known = new Set(existing.map((r) => r.sha));

    let imported = 0;
    for (const row of rows) {
      if (known.has(row.sha)) continue;
      // Skip the repo's initial empty bootstrap commit which has no parent
      // and zero files — it's noise.
      if (row.filesChanged === 0 && /initial empty commit/i.test(row.message)) continue;

      const at = new Date(row.unixTs * 1000);
      const [inserted] = await db
        .insert(commits)
        .values({
          agentId,
          taskId,
          sha: row.sha,
          branch: row.branch,
          message: row.message,
          filesChanged: row.filesChanged,
          createdAt: at,
        })
        .returning();

      if (inserted) {
        imported += 1;
        await eventBus.emit({
          type: 'commit.created',
          commitId: inserted.id,
          agentId,
          taskId,
          sha: row.sha,
          branch: row.branch,
          filesChanged: row.filesChanged,
          message: row.message,
          at: at.toISOString(),
        });
      }
    }
    if (imported > 0) {
      logger.info({ agentId, imported }, 'Imported commits from worktree');
    }
  } catch (err) {
    logger.warn({ err, agentId, worktreePath }, 'syncAgentCommits failed');
  }
}

/**
 * Dependencies injectable to make `runAgentTurn` unit-testable. In production
 * we pass `{}` and the defaults are used.
 */
export interface RunAgentTurnDeps {
  queryFn?: typeof query;
  loadAgent?: (id: string) => Promise<AgentRow | null>;
}

/**
 * Run a single turn for the given agent: pull unread messages, call the
 * SDK with the previous session resumed, persist the new session id.
 */
export async function runAgentTurn(
  agentId: string,
  deps: RunAgentTurnDeps = {},
): Promise<void> {
  const queryImpl = deps.queryFn ?? query;
  const loadAgent =
    deps.loadAgent ??
    (async (id: string) => {
      const rows = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
      return rows[0] ?? null;
    });

  const agent = await loadAgent(agentId);
  if (!agent) {
    logger.warn({ agentId }, 'runAgentTurn: agent not found');
    return;
  }

  const unread = await getUnreadMessages(agent.id, 20);
  if (unread.length === 0) {
    logger.debug({ agentId }, 'No unread messages, skipping turn');
    return;
  }

  // ── Budget guard: bail early if the agent has blown its cost cap. ───
  // We let the operator know via an in-app message instead of silently
  // dropping the turn, so the work isn't lost on the next run either.
  const budget = await checkBudget(agent);
  if (!budget.allow) {
    logger.warn({ agentId, reason: budget.reason }, 'Budget guard tripped');
    await db.insert(messages).values({
      fromAgentId: null,
      toAgentId: agent.id,
      type: 'status',
      subject: 'Budget cap reached',
      content: `Your turn was paused before invoking the model.\n\n${budget.reason}\n\nReply once the cap is raised and the operator re-enqueues you.`,
      deliveredAt: new Date(),
      readAt: new Date(),
    });
    await setAgentStatus(agent.id, 'blocked');
    return;
  }

  // Build a map from sender id → name for the prompt.
  const senderIds = Array.from(new Set(unread.map((m) => m.fromAgentId).filter((x): x is string => !!x)));
  const senderRows = senderIds.length ? await db.select().from(agents).where(inArray(agents.id, senderIds)) : [];
  const senderNameById = new Map(senderRows.map((r) => [r.id, r.name]));

  // Build the system prompt with a LIVE teammate roster so newly-added or
  // renamed agents are immediately visible. The static .md has a default
  // roster for readability but this override is authoritative.
  const allAgents = await db.select().from(agents);
  const persona = await buildSystemPrompt(agent, allAgents);
  const prompt = formatInboxAsPrompt(unread, senderNameById);

  // Decide the CWD for this turn:
  //   1. If any unread message is about a task attached to a GitHub project,
  //      work INSIDE the project's local clone on a per-task branch. That
  //      way commits go to a real repo and we can open a PR at the end.
  //   2. Otherwise fall back to the agent's throwaway git worktree.
  let worktreePath: string | null = agent.worktreePath;
  let activeBranch: string | null = null;
  let activeProjectTask: { id: string; projectId: string } | null = null;

  const firstTaskIdInBatch = unread.find((m) => m.taskId)?.taskId ?? null;
  if (firstTaskIdInBatch) {
    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, firstTaskIdInBatch))
      .limit(1);
    if (task?.projectId) {
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, task.projectId))
        .limit(1);
      if (project) {
        try {
          const clonePath =
            project.clonePath ?? (await cloneRepo(project.repoOwner, project.repoName));
          const shortId = task.id.slice(0, 8);
          const branch = `agent/${agent.name}/task-${shortId}`;
          await ensureBranch(clonePath, branch, project.defaultBranch);
          worktreePath = clonePath;
          activeBranch = branch;
          activeProjectTask = { id: task.id, projectId: project.id };

          // Remember the branch on the task row so the UI can show it.
          if (task.branch !== branch) {
            await db.update(tasks).set({ branch }).where(eq(tasks.id, task.id));
          }
          logger.info(
            {
              agentId: agent.id,
              projectId: project.id,
              repo: `${project.repoOwner}/${project.repoName}`,
              branch,
              clonePath,
            },
            'Turn bound to project branch',
          );
        } catch (err) {
          logger.warn(
            { err, agentId: agent.id, projectId: task.projectId },
            'Project checkout failed, falling back to agent worktree',
          );
        }
      }
    }
  }

  if (!worktreePath) {
    try {
      worktreePath = await createWorktree(agent.name);
      await db.update(agents).set({ worktreePath }).where(eq(agents.id, agent.id));
      logger.info({ agentId: agent.id, worktreePath }, 'Bootstrapped worktree on-the-fly');
    } catch (err) {
      logger.error({ err, agentId: agent.id }, 'Failed to create worktree; aborting turn');
      await setAgentStatus(agent.id, 'error');
      return;
    }
  }

  // When an agent picks up new assignment messages, flip the related tasks
  // to `in_progress` automatically. Closes the loophole where the agent
  // reads the inbox, does some work, and forgets to move the kanban card —
  // which otherwise looks to the human like a "stuck" task.
  const taskIdsToAdvance = Array.from(
    new Set(
      unread
        .filter((m) => m.type === 'assignment' && m.taskId)
        .map((m) => m.taskId as string),
    ),
  );
  if (taskIdsToAdvance.length) {
    await db
      .update(tasks)
      .set({ status: 'in_progress', updatedAt: new Date() })
      .where(and(inArray(tasks.id, taskIdsToAdvance), eq(tasks.status, 'todo')));
    await db
      .update(tasks)
      .set({ status: 'in_progress', updatedAt: new Date() })
      .where(and(inArray(tasks.id, taskIdsToAdvance), eq(tasks.status, 'backlog')));
    // Broadcast task updates so the UI repaints cards live.
    for (const tid of taskIdsToAdvance) {
      const [t] = await db.select().from(tasks).where(eq(tasks.id, tid)).limit(1);
      if (t) {
        await eventBus.emit({
          type: 'task.updated',
          taskId: t.id,
          status: t.status as never,
          assigneeId: t.assigneeId,
          at: new Date().toISOString(),
        });
      }
    }
  }

  await setAgentStatus(agent.id, 'working');
  logger.info({ agentId, agentName: agent.name, unread: unread.length, worktreePath }, 'Running agent turn');

  let newSessionId: string | undefined;
  let usageResult: unknown = null;
  const turnStartedAt = new Date();

  try {
    // ── Per-agent tuning with sane fallbacks ────────────────────────
    const model = (agent.model as AgentModel | null) ?? DEFAULT_MODEL;
    const maxTurns = agent.maxTurns ?? DEFAULT_MAX_TURNS ?? env.AGENT_MAX_TURNS;
    const effort = (agent.extendedThinking as AgentEffort | null) ?? DEFAULT_EFFORT;
    // SDK accepts 'low' | 'medium' | 'high' | 'xhigh' | 'max' or a number.
    // We map our "off" sentinel to undefined (leave effort unset).
    const sdkEffort = effort === 'off' ? undefined : effort;

    const queryInput = {
      prompt,
      options: {
        systemPrompt: persona,
        model,
        ...(sdkEffort ? { effort: sdkEffort } : {}),
        resume: agent.sessionId ?? undefined,
        cwd: worktreePath,
        mcpServers: { agentboard: buildMcpServer(agent.id) },
        allowedTools: AGENT_ALLOWED_TOOLS,
        permissionMode: 'acceptEdits' as const,
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [guardrailsHook(agent.id)] }],
          PostToolUse: [{ matcher: '.*', hooks: [activityHook(agent.id)] }],
          Stop: [{ matcher: '.*', hooks: [sessionHook(agent.id)] }],
        },
        maxTurns,
        // CRITICAL: isolate agents from the host user's Claude Code config
        // (plugins, slash commands, user-level hooks, MCP servers). Without
        // this, agents inherit the operator's environment — e.g. a plugin
        // SessionStart hook could hijack their first message.
        settingSources: [] as string[],
      },
    };
    logger.debug(
      { agentId: agent.id, model, maxTurns, effort, sdkEffort },
      'SDK query options',
    );
    // Wallclock guard — if a turn ever hangs (bad session id, SDK stall,
    // network flap), bail after AGENT_TURN_TIMEOUT_MS instead of blocking
    // the whole dispatcher forever. The underlying claude subprocess may
    // keep going briefly, but the runner is free to ack + move on.
    const deadline = Date.now() + env.AGENT_TURN_TIMEOUT_MS;
    let timedOut = false;

    // The SDK type might narrow strictly; we know our shape is correct.
    // Cast through unknown to avoid fighting the compiler on nested types.
    for await (const msg of queryImpl(queryInput as unknown as Parameters<typeof queryImpl>[0])) {
      if (Date.now() > deadline) {
        timedOut = true;
        logger.warn(
          { agentId: agent.id, timeoutMs: env.AGENT_TURN_TIMEOUT_MS },
          'Agent turn exceeded timeout, aborting',
        );
        break;
      }
      const m = msg as {
        type?: string;
        session_id?: string;
        message?: {
          content?: Array<
            | { type: 'text'; text: string }
            | { type: 'thinking'; thinking: string }
            | { type: 'tool_use'; name: string; input?: unknown }
            | { type: string }
          >;
        };
      };

      // Capture session id + usage payload for context persistence + cost.
      if (m.type === 'result') {
        if (typeof m.session_id === 'string') newSessionId = m.session_id;
        usageResult = msg;
      }

      // Surface the assistant's reasoning (text + thinking blocks) live to
      // the UI so operators can watch what the agent is chewing on.
      if (m.type === 'assistant' && Array.isArray(m.message?.content)) {
        for (const block of m.message.content) {
          const now = new Date().toISOString();
          if (block.type === 'text' && typeof (block as { text?: string }).text === 'string') {
            const text = (block as { text: string }).text.trim();
            if (text) {
              await eventBus.emit({
                type: 'agent.thinking',
                agentId: agent.id,
                text,
                at: now,
              });
            }
          } else if (
            block.type === 'thinking' &&
            typeof (block as { thinking?: string }).thinking === 'string'
          ) {
            const thinking = (block as { thinking: string }).thinking.trim();
            if (thinking) {
              await eventBus.emit({
                type: 'agent.thinking',
                agentId: agent.id,
                text: thinking,
                at: now,
              });
            }
          } else if (block.type === 'tool_use') {
            const tu = block as { name?: string; input?: unknown };
            if (tu.name) {
              await eventBus.emit({
                type: 'agent.tool_attempt',
                agentId: agent.id,
                tool: tu.name,
                input: tu.input,
                at: now,
              });
            }
          }
        }
      }
    }

    if (newSessionId) {
      await db.update(agents).set({ sessionId: newSessionId }).where(eq(agents.id, agent.id));
      logger.debug({ agentId: agent.id, sessionId: newSessionId }, 'Persisted SDK session id');
    }

    // Drop a tamper-evident audit row for this turn.
    await audit({
      kind: 'agent.turn',
      actor: agent.name,
      payload: {
        agentId: agent.id,
        sessionId: newSessionId ?? null,
        unread: unread.length,
        timedOut,
      },
    });

    // Persist usage + cost so /spend and budget guards have data.
    try {
      const usage = extractUsage(usageResult);
      const cost = computeCostMicroUsd(model, usage);
      await db.insert(usageEvents).values({
        agentId: agent.id,
        taskId: activeProjectTask?.id ?? firstTaskIdInBatch ?? null,
        sessionId: newSessionId ?? agent.sessionId ?? null,
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
        cacheReadTokens: usage.cacheReadTokens,
        costMicroUsd: cost,
        durationMs: Date.now() - turnStartedAt.getTime(),
        succeeded: !timedOut,
        timedOut,
        startedAt: turnStartedAt,
        endedAt: new Date(),
      });
      logger.debug(
        { agentId: agent.id, costMicroUsd: cost, ...usage },
        'Recorded turn usage',
      );
    } catch (err) {
      logger.warn({ err, agentId: agent.id }, 'Failed to record usage');
    }

    // Whether or not the agent used the commit_code tool, pick up any commits
    // that actually landed in its worktree during this turn.
    await syncAgentCommits(agent.id, worktreePath, activeProjectTask?.id ?? null);
    void activeBranch; // branch already persisted above; kept here for future use

    // If we bailed due to timeout, leave the messages as unread so the next
    // enqueue picks them up — the agent didn't actually get through them.
    if (!timedOut) {
      await markMessagesRead(unread.map((m) => m.id));
    }
    // Don't pin the agent to 'error' on a timeout — that requires a manual
    // reset and stalls the sprint. Drop them back to 'idle' and re-enqueue
    // so the next dispatch retries with whatever fresh state they have.
    if (timedOut) {
      logger.warn({ agentId: agent.id, unread: unread.length }, 'Turn timed out, re-enqueueing');
      await setAgentStatus(agent.id, 'idle');
      try {
        await enqueueDispatch(agent.id);
      } catch (err) {
        logger.warn({ err, agentId: agent.id }, 'Re-enqueue after timeout failed');
      }
    } else {
      await setAgentStatus(agent.id, 'idle');
    }
  } catch (e) {
    logger.error({ err: e, agentId: agent.id }, 'runAgentTurn failed');

    // Recover from stale session-id: Claude Code GCs old conversations,
    // so a previously-stored sessionId may be unknown by the time we
    // try to resume. Wipe it so the next turn starts fresh — the agent
    // loses its raw chat history but the persona, rules, decisions,
    // and live roster all rebuild on the next prompt.
    const errMsg = (e as { message?: string })?.message ?? '';
    const isStaleSession =
      /no conversation found with session id/i.test(errMsg) ||
      /session_id .* not found/i.test(errMsg) ||
      /unknown session/i.test(errMsg);
    if (isStaleSession && agent.sessionId) {
      logger.warn(
        { agentId: agent.id, oldSessionId: agent.sessionId },
        'Stale Claude Code session id detected — clearing for next turn',
      );
      try {
        await db.update(agents).set({ sessionId: null }).where(eq(agents.id, agent.id));
      } catch (e2) {
        logger.error({ err: e2 }, 'Failed to clear stale session id');
      }
      // Re-enqueue this agent so we retry immediately with a fresh
      // session. The unread messages are still un-acked, so they'll be
      // picked back up.
      try {
        await enqueueDispatch(agent.id);
      } catch (e2) {
        logger.warn({ err: e2 }, 'Failed to re-enqueue after stale-session recovery');
      }
    }

    try {
      // After a successful self-recovery the next turn will flip the
      // agent back to working/idle. Mark error only when we couldn't
      // self-heal so the operator sees the red dot.
      await setAgentStatus(agent.id, isStaleSession ? 'idle' : 'error');
    } catch (e2) {
      logger.error({ err: e2 }, 'Failed to set agent status after error');
    }
  }
}
