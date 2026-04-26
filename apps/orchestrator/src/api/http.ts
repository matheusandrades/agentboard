import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  AgentEffortSchema,
  AgentModelSchema,
  AgentRoleSchema,
  AgentStatusSchema,
  MessageTypeSchema,
  TaskStatusSchema,
} from '@agentboard/shared';

import { db } from '../db/client.js';
import {
  activityLog,
  agents,
  approvals,
  auditEvents,
  commits,
  githubConnections,
  messages,
  notifications,
  previews,
  projects,
  sprints,
  tasks,
} from '../db/schema.js';
import {
  cloneRepo,
  disconnectOauth,
  disconnectPat,
  exchangeOauthCode,
  getGithubStatus,
  getIssue,
  listAccounts,
  listIssues,
  listProjectBranches,
  listPullRequests,
  listRepos,
  saveOauthConnection,
  savePersonalAccessToken,
} from '../github/client.js';
import { spendSummary } from '../lib/budget.js';
import { listModelsWithPricing } from '../lib/pricing.js';
import { audit, verifyAuditChain } from '../lib/audit.js';
import { pingDb } from '../db/client.js';
import { pingRedis } from '../redis/client.js';
import { enqueueDispatch } from '../redis/streams.js';
import { eventBus } from '../events/bus.js';
import { randomUUID } from 'node:crypto';
import { createWorktree, removeWorktree } from '../worktree/manager.js';
import { launchPreview, sanitizeProjectName, stopPreview } from '../worktree/docker.js';
import { env, paths } from '../config.js';
import { logger } from '../logger.js';
import { loadRulesTemplate } from '../agents/persona.js';
import {
  deleteSetting,
  getSetting,
  setSetting,
  type GithubAppSettings,
  type GithubOauthSettings,
} from '../lib/settings.js';
import {
  buildManifest,
  exchangeAppManifestCode,
  getInstallationToken,
} from '../github/app.js';
import { requireAdmin } from '../auth/middleware.js';

const execFileAsync = promisify(execFile);

/* -------------------------------- schemas -------------------------------- */

const createAgentSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9_-]*$/i, 'alphanumeric, dash or underscore only'),
  role: AgentRoleSchema,
  personaPath: z.string().optional(),
  persona: z.string().optional(),
});

const patchAgentSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9_-]*$/i).optional(),
  role: AgentRoleSchema.optional(),
  model: AgentModelSchema.nullable().optional(),
  maxTurns: z.number().int().min(1).max(200).nullable().optional(),
  extendedThinking: AgentEffortSchema.nullable().optional(),
});

const updatePersonaSchema = z.object({
  content: z.string().max(200_000),
});

const createTaskBodySchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  assigneeId: z.string().uuid().optional(),
  sprintId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  priority: z.number().int().min(1).max(5).optional(),
  parentId: z.string().uuid().optional(),
  status: TaskStatusSchema.optional(),
});

const patchTaskBodySchema = z.object({
  title: z.string().max(500).optional(),
  description: z.string().optional().nullable(),
  status: TaskStatusSchema.optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  sprintId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  priority: z.number().int().min(1).max(5).optional(),
});

const createSprintSchema = z.object({
  name: z.string().min(1).max(200),
  goal: z.string().optional(),
  status: z.enum(['planning', 'active', 'closed']).optional(),
  startedAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
});

const postMessageBodySchema = z.object({
  // Preferred: friendly names (the UI uses these). "stakeholder" = null sender,
  // "*" = broadcast. Accept explicit UUIDs too.
  from: z.string().optional(),
  to: z.string().optional(),
  fromAgentId: z.string().uuid().nullable().optional(),
  toAgentId: z.string().uuid().nullable().optional(),
  toAgentName: z.string().optional(),
  type: MessageTypeSchema,
  subject: z.string().min(1).max(500),
  content: z.string().min(1),
  taskId: z.string().uuid().optional(),
  threadId: z.string().uuid().optional(),
});

const taskQuerySchema = z.object({
  sprint: z.string().uuid().optional(),
  status: TaskStatusSchema.optional(),
  assigneeId: z.string().uuid().optional(),
});

const messageQuerySchema = z.object({
  agentId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const activityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  agentId: z.string().uuid().optional(),
});

const commitsQuerySchema = z.object({
  agentId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/* ------------------------------ helpers ---------------------------------- */

/**
 * Convert DB message rows into the canonical AgentMessage shape the frontend
 * expects (friendly `from`/`to` names rather than UUIDs). Fetches all agents
 * up-front so the mapping is O(N).
 */
async function toAgentMessages(
  rows: Array<typeof messages.$inferSelect>,
): Promise<
  Array<{
    id: string;
    from: string;
    to: string;
    type: string;
    subject: string;
    content: string;
    taskId: string | null;
    threadId: string | null;
    createdAt: string;
  }>
> {
  if (rows.length === 0) return [];
  const referenced = new Set<string>();
  for (const r of rows) {
    if (r.fromAgentId) referenced.add(r.fromAgentId);
    if (r.toAgentId) referenced.add(r.toAgentId);
  }
  const rs = referenced.size
    ? await db.select().from(agents)
    : [];
  const byId = new Map(rs.map((a) => [a.id, a.name] as const));
  return rows.map((r) => ({
    id: r.id,
    from: r.fromAgentId ? (byId.get(r.fromAgentId) ?? r.fromAgentId) : 'stakeholder',
    to: r.toAgentId ? (byId.get(r.toAgentId) ?? r.toAgentId) : '*',
    type: r.type,
    subject: r.subject ?? '',
    content: r.content,
    taskId: r.taskId,
    threadId: r.threadId,
    createdAt:
      r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  }));
}

function parseOr400<T>(
  schema: z.ZodType<T>,
  value: unknown,
  reply: FastifyReply,
): { ok: true; value: T } | { ok: false } {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    reply.code(400).send({
      error: 'validation_error',
      issues: parsed.error.issues,
    });
    return { ok: false };
  }
  return { ok: true, value: parsed.data };
}

function sendError(
  reply: FastifyReply,
  code: number,
  error: string,
  details?: unknown,
): void {
  reply.code(code).send({ error, details });
}

/* ------------------------------ plugin ----------------------------------- */

export async function registerHttpRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------ health ------------------------------- */
  app.get('/api/health', async () => {
    const [dbOk, redisOk] = await Promise.all([pingDb(), pingRedis()]);
    // "subscription" = relying on the locally-installed `claude` CLI (Pro/Max)
    // "api"          = explicit ANTHROPIC_API_KEY in env (per-token billing)
    const anthropicMode: 'subscription' | 'api' = process.env.ANTHROPIC_API_KEY
      ? 'api'
      : 'subscription';
    return { ok: dbOk && redisOk, db: dbOk, redis: redisOk, anthropicMode };
  });

  /* ------------------------------ agents ------------------------------- */
  app.get('/api/agents', async () => {
    const rows = await db.query.agents.findMany();
    return rows;
  });

  app.get(
    '/api/agents/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const id = req.params.id;
      if (!z.string().uuid().safeParse(id).success) return sendError(reply, 400, 'invalid_id');

      const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
      if (!agent) return sendError(reply, 404, 'agent_not_found');

      const rows = await db
        .select()
        .from(messages)
        .where(eq(messages.toAgentId, id))
        .orderBy(desc(messages.createdAt))
        .limit(20);

      return { agent, messages: await toAgentMessages(rows) };
    },
  );

  app.post('/api/agents', async (req, reply) => {
    const parsed = parseOr400(createAgentSchema, req.body, reply);
    if (!parsed.ok) return;
    const body = parsed.value;

    try {
      // Check name uniqueness up-front for a clean 409.
      const [dupe] = await db.select().from(agents).where(eq(agents.name, body.name)).limit(1);
      if (dupe) return sendError(reply, 409, 'name_taken');

      // Resolve persona file:
      //   - if `persona` content was provided, write to agents/custom/{name}.md
      //   - else if `personaPath` was provided, trust it
      //   - else fall back to the role template agents/{role}.md
      let personaPath: string;
      if (body.persona !== undefined) {
        personaPath = path.join(paths.personasDir, 'custom', `${body.name}.md`);
        await fs.mkdir(path.dirname(personaPath), { recursive: true });
        await fs.writeFile(personaPath, body.persona, 'utf-8');
      } else if (body.personaPath) {
        personaPath = body.personaPath;
      } else {
        personaPath = path.join(paths.personasDir, `${body.role}.md`);
      }

      const worktreePath = await createWorktree(body.name);

      const [created] = await db
        .insert(agents)
        .values({
          name: body.name,
          role: body.role,
          personaPath,
          worktreePath,
          status: 'idle',
        })
        .returning();

      reply.code(201);
      return created;
    } catch (err) {
      logger.error({ err, body }, 'POST /api/agents failed');
      return sendError(reply, 500, 'create_failed', (err as Error).message);
    }
  });

  app.patch(
    '/api/agents/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const id = req.params.id;
      if (!z.string().uuid().safeParse(id).success) return sendError(reply, 400, 'invalid_id');
      const parsed = parseOr400(patchAgentSchema, req.body, reply);
      if (!parsed.ok) return;
      const body = parsed.value;

      const hasAny =
        body.name ||
        body.role ||
        body.model !== undefined ||
        body.maxTurns !== undefined ||
        body.extendedThinking !== undefined;
      if (!hasAny) return sendError(reply, 400, 'empty_patch');

      const [current] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
      if (!current) return sendError(reply, 404, 'agent_not_found');

      if (body.name && body.name !== current.name) {
        const [dupe] = await db.select().from(agents).where(eq(agents.name, body.name)).limit(1);
        if (dupe && dupe.id !== id) return sendError(reply, 409, 'name_taken');
      }

      try {
        const [updated] = await db
          .update(agents)
          .set({
            ...(body.name ? { name: body.name } : {}),
            ...(body.role ? { role: body.role } : {}),
            ...(body.model !== undefined ? { model: body.model } : {}),
            ...(body.maxTurns !== undefined ? { maxTurns: body.maxTurns } : {}),
            ...(body.extendedThinking !== undefined
              ? { extendedThinking: body.extendedThinking }
              : {}),
          })
          .where(eq(agents.id, id))
          .returning();
        return updated;
      } catch (err) {
        logger.error({ err, id, body }, 'PATCH /api/agents failed');
        return sendError(reply, 500, 'update_failed', (err as Error).message);
      }
    },
  );

  app.delete(
    '/api/agents/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const id = req.params.id;
      if (!z.string().uuid().safeParse(id).success) return sendError(reply, 400, 'invalid_id');
      const [current] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
      if (!current) return sendError(reply, 404, 'agent_not_found');

      // Best-effort cleanup: worktree + custom persona file. Never fail the
      // DELETE on filesystem issues.
      try {
        if (current.worktreePath) await removeWorktree(current.worktreePath);
      } catch (err) {
        logger.warn({ err, id }, 'worktree cleanup failed');
      }
      if (current.personaPath && current.personaPath.includes(`${path.sep}custom${path.sep}`)) {
        try {
          await fs.unlink(current.personaPath);
        } catch (err) {
          logger.warn({ err, personaPath: current.personaPath }, 'persona unlink failed');
        }
      }

      // Rows in messages/tasks/commits/activity_log reference agents.id with
      // ON DELETE NO ACTION — null them out first so the delete succeeds.
      await db.update(tasks).set({ assigneeId: null }).where(eq(tasks.assigneeId, id));
      await db.update(tasks).set({ createdBy: null }).where(eq(tasks.createdBy, id));
      await db.update(messages).set({ toAgentId: null }).where(eq(messages.toAgentId, id));
      await db.update(messages).set({ fromAgentId: null }).where(eq(messages.fromAgentId, id));
      await db.update(commits).set({ agentId: null }).where(eq(commits.agentId, id));
      await db.update(activityLog).set({ agentId: null }).where(eq(activityLog.agentId, id));

      await db.delete(agents).where(eq(agents.id, id));
      reply.code(204);
      return;
    },
  );

  /* --------------------------- personas ---------------------------- */
  app.get(
    '/api/agents/:id/persona',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const id = req.params.id;
      if (!z.string().uuid().safeParse(id).success) return sendError(reply, 400, 'invalid_id');
      const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
      if (!agent) return sendError(reply, 404, 'agent_not_found');
      try {
        const content = await fs.readFile(agent.personaPath, 'utf-8');
        reply.header('content-type', 'text/plain; charset=utf-8');
        return content;
      } catch (err) {
        logger.warn({ err, id }, 'persona read failed');
        return sendError(reply, 404, 'persona_file_missing', (err as Error).message);
      }
    },
  );

  app.put(
    '/api/agents/:id/persona',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const id = req.params.id;
      if (!z.string().uuid().safeParse(id).success) return sendError(reply, 400, 'invalid_id');
      const parsed = parseOr400(updatePersonaSchema, req.body, reply);
      if (!parsed.ok) return;

      const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
      if (!agent) return sendError(reply, 404, 'agent_not_found');

      // If the agent still points at a shared role template, migrate them to
      // their own file so our write doesn't affect other agents.
      let targetPath = agent.personaPath;
      const isSharedTemplate =
        !agent.personaPath.includes(`${path.sep}custom${path.sep}`) &&
        agent.personaPath.startsWith(paths.personasDir);

      if (isSharedTemplate) {
        targetPath = path.join(paths.personasDir, 'custom', `${agent.name}.md`);
      }

      try {
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, parsed.value.content, 'utf-8');

        if (targetPath !== agent.personaPath) {
          const [updated] = await db
            .update(agents)
            .set({ personaPath: targetPath })
            .where(eq(agents.id, id))
            .returning();
          return updated;
        }
        return agent;
      } catch (err) {
        logger.error({ err, id, targetPath }, 'persona write failed');
        return sendError(reply, 500, 'persona_write_failed', (err as Error).message);
      }
    },
  );

  app.get(
    '/api/personas/templates/:role',
    async (req: FastifyRequest<{ Params: { role: string } }>, reply) => {
      const parsed = AgentRoleSchema.safeParse(req.params.role);
      if (!parsed.success) return sendError(reply, 400, 'invalid_role');
      const filePath = path.join(paths.personasDir, `${parsed.data}.md`);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        reply.header('content-type', 'text/plain; charset=utf-8');
        return content;
      } catch (err) {
        logger.warn({ err, role: parsed.data }, 'template read failed');
        return sendError(reply, 404, 'template_not_found', (err as Error).message);
      }
    },
  );

  /* ----------------------------- rules ----------------------------- */
  // Bundled rules template per role. Used by the UI's "Reset to default"
  // button and by the runner when an agent's `rules` column is NULL.
  app.get(
    '/api/rules/templates/:role',
    async (req: FastifyRequest<{ Params: { role: string } }>, reply) => {
      const parsed = AgentRoleSchema.safeParse(req.params.role);
      if (!parsed.success) return sendError(reply, 400, 'invalid_role');
      const text = await loadRulesTemplate(parsed.data);
      reply.header('content-type', 'text/plain; charset=utf-8');
      return text;
    },
  );

  // Get the effective rules for an agent — either the row override or the
  // bundled template if `rules` is NULL.
  app.get(
    '/api/agents/:id/rules',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const id = req.params.id;
      if (!z.string().uuid().safeParse(id).success) return sendError(reply, 400, 'invalid_id');
      const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
      if (!agent) return sendError(reply, 404, 'agent_not_found');
      const text = agent.rules === null ? await loadRulesTemplate(agent.role) : agent.rules;
      reply.header('content-type', 'text/plain; charset=utf-8');
      return text ?? '';
    },
  );

  const updateRulesSchema = z.object({ content: z.string().max(20_000) });
  app.put(
    '/api/agents/:id/rules',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const id = req.params.id;
      if (!z.string().uuid().safeParse(id).success) return sendError(reply, 400, 'invalid_id');
      const parsed = parseOr400(updateRulesSchema, req.body, reply);
      if (!parsed.ok) return;
      const [updated] = await db
        .update(agents)
        .set({ rules: parsed.value.content })
        .where(eq(agents.id, id))
        .returning();
      if (!updated) return sendError(reply, 404, 'agent_not_found');
      return updated;
    },
  );

  // Reset the row override so the agent falls back to the bundled template.
  app.delete(
    '/api/agents/:id/rules',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const id = req.params.id;
      if (!z.string().uuid().safeParse(id).success) return sendError(reply, 400, 'invalid_id');
      const [updated] = await db
        .update(agents)
        .set({ rules: null })
        .where(eq(agents.id, id))
        .returning();
      if (!updated) return sendError(reply, 404, 'agent_not_found');
      return updated;
    },
  );

  /* ------------------------------ tasks -------------------------------- */
  app.get('/api/tasks', async (req, reply) => {
    const parsed = parseOr400(taskQuerySchema, req.query, reply);
    if (!parsed.ok) return;
    const q = parsed.value;

    const conditions = [] as ReturnType<typeof eq>[];
    if (q.sprint) conditions.push(eq(tasks.sprintId, q.sprint));
    if (q.status) conditions.push(eq(tasks.status, q.status));
    if (q.assigneeId) conditions.push(eq(tasks.assigneeId, q.assigneeId));

    const where = conditions.length ? and(...conditions) : undefined;
    const rows = await db
      .select()
      .from(tasks)
      .where(where as never)
      .orderBy(desc(tasks.createdAt));
    return rows;
  });

  app.post('/api/tasks', async (req, reply) => {
    const parsed = parseOr400(createTaskBodySchema, req.body, reply);
    if (!parsed.ok) return;
    const body = parsed.value;

    try {
      const [created] = await db
        .insert(tasks)
        .values({
          title: body.title,
          description: body.description ?? null,
          status: body.status ?? 'backlog',
          assigneeId: body.assigneeId ?? null,
          createdBy: null, // stakeholder
          priority: body.priority ?? 3,
          parentId: body.parentId ?? null,
          sprintId: body.sprintId ?? null,
          projectId: body.projectId ?? null,
        })
        .returning();

      if (!created) return sendError(reply, 500, 'create_failed');

      await eventBus.emit({
        type: 'task.created',
        taskId: created.id,
        title: created.title,
        at: new Date().toISOString(),
      });

      if (created.assigneeId) await enqueueDispatch(created.assigneeId);

      reply.code(201);
      return created;
    } catch (err) {
      logger.error({ err, body }, 'POST /api/tasks failed');
      return sendError(reply, 500, 'create_failed', (err as Error).message);
    }
  });

  app.patch(
    '/api/tasks/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const id = req.params.id;
      if (!z.string().uuid().safeParse(id).success) return sendError(reply, 400, 'invalid_id');
      const parsed = parseOr400(patchTaskBodySchema, req.body, reply);
      if (!parsed.ok) return;
      const body = parsed.value;

      try {
        const patch: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };
        if (body.title !== undefined) patch.title = body.title;
        if (body.description !== undefined) patch.description = body.description;
        if (body.status !== undefined) patch.status = body.status;
        if (body.assigneeId !== undefined) patch.assigneeId = body.assigneeId;
        if (body.sprintId !== undefined) patch.sprintId = body.sprintId;
        if (body.projectId !== undefined) patch.projectId = body.projectId;
        if (body.priority !== undefined) patch.priority = body.priority;

        const [updated] = await db.update(tasks).set(patch).where(eq(tasks.id, id)).returning();
        if (!updated) return sendError(reply, 404, 'task_not_found');

        await eventBus.emit({
          type: 'task.updated',
          taskId: updated.id,
          status: updated.status as never,
          assigneeId: updated.assigneeId,
          at: new Date().toISOString(),
        });

        if (body.assigneeId) await enqueueDispatch(body.assigneeId);

        return updated;
      } catch (err) {
        logger.error({ err, id, body }, 'PATCH /api/tasks failed');
        return sendError(reply, 500, 'update_failed', (err as Error).message);
      }
    },
  );

  /* ----------------------------- sprints ------------------------------- */
  app.get('/api/sprints', async () => {
    const rows = await db.select().from(sprints).orderBy(desc(sprints.startedAt));
    return rows;
  });

  app.post('/api/sprints', async (req, reply) => {
    const parsed = parseOr400(createSprintSchema, req.body, reply);
    if (!parsed.ok) return;
    const body = parsed.value;

    try {
      const [created] = await db
        .insert(sprints)
        .values({
          name: body.name,
          goal: body.goal ?? null,
          status: body.status ?? 'active',
          startedAt: body.startedAt ? new Date(body.startedAt) : null,
          endsAt: body.endsAt ? new Date(body.endsAt) : null,
        })
        .returning();
      reply.code(201);
      return created;
    } catch (err) {
      logger.error({ err, body }, 'POST /api/sprints failed');
      return sendError(reply, 500, 'create_failed', (err as Error).message);
    }
  });

  /* ---------------------------- messages ------------------------------- */
  app.post('/api/messages', async (req, reply) => {
    const parsed = parseOr400(postMessageBodySchema, req.body, reply);
    if (!parsed.ok) return;
    const body = parsed.value;

    try {
      // ── Resolve recipient ────────────────────────────────────────
      // Priority: toAgentId → toAgentName → to (which may be '*' for broadcast).
      const recipientCandidate = body.to ?? body.toAgentName;
      let toAgentId: string | null = null;

      if (body.toAgentId) {
        toAgentId = body.toAgentId;
      } else if (recipientCandidate === '*') {
        toAgentId = null; // broadcast
      } else if (recipientCandidate) {
        const [row] = await db
          .select()
          .from(agents)
          .where(eq(agents.name, recipientCandidate))
          .limit(1);
        if (!row) return sendError(reply, 404, 'recipient_not_found', { to: recipientCandidate });
        toAgentId = row.id;
      } else {
        return sendError(reply, 400, 'missing_recipient');
      }

      // ── Resolve sender ──────────────────────────────────────────
      // "stakeholder" (or no value) → null. Otherwise look up by name.
      let fromAgentId: string | null = body.fromAgentId ?? null;
      if (!fromAgentId && body.from && body.from !== 'stakeholder') {
        const [sender] = await db
          .select()
          .from(agents)
          .where(eq(agents.name, body.from))
          .limit(1);
        if (!sender) return sendError(reply, 404, 'sender_not_found', { from: body.from });
        fromAgentId = sender.id;
      }

      const [inserted] = await db
        .insert(messages)
        .values({
          fromAgentId,
          toAgentId,
          type: body.type,
          subject: body.subject,
          content: body.content,
          taskId: body.taskId ?? null,
          threadId: body.threadId ?? null,
          deliveredAt: new Date(),
        })
        .returning();

      if (!inserted) return sendError(reply, 500, 'insert_failed');

      // Wake recipient(s). Broadcast → enqueue every non-sender agent.
      if (toAgentId) {
        await enqueueDispatch(toAgentId);
      } else {
        const everyone = await db.select().from(agents);
        for (const a of everyone) {
          if (a.id === fromAgentId) continue;
          await enqueueDispatch(a.id);
        }
      }

      await eventBus.emit({
        type: 'message.sent',
        messageId: inserted.id,
        fromAgentId,
        toAgentId,
        messageType: body.type,
        subject: body.subject,
        at: new Date().toISOString(),
      });

      // Normalize response to match the frontend's AgentMessage shape.
      reply.code(201);
      const [normalized] = await toAgentMessages([inserted]);
      return normalized;
    } catch (err) {
      logger.error({ err, body }, 'POST /api/messages failed');
      return sendError(reply, 500, 'send_failed', (err as Error).message);
    }
  });

  app.get('/api/messages', async (req, reply) => {
    const parsed = parseOr400(messageQuerySchema, req.query, reply);
    if (!parsed.ok) return;
    const q = parsed.value;
    const limit = q.limit ?? 100;

    const rows = q.agentId
      ? await db
          .select()
          .from(messages)
          .where(or(eq(messages.toAgentId, q.agentId), eq(messages.fromAgentId, q.agentId)))
          .orderBy(desc(messages.createdAt))
          .limit(limit)
      : await db
          .select()
          .from(messages)
          .orderBy(desc(messages.createdAt))
          .limit(limit);
    return toAgentMessages(rows);
  });

  /* ---------------------------- activity ------------------------------- */
  app.get('/api/activity', async (req, reply) => {
    const parsed = parseOr400(activityQuerySchema, req.query, reply);
    if (!parsed.ok) return;
    const q = parsed.value;

    const rows = q.agentId
      ? await db
          .select()
          .from(activityLog)
          .where(eq(activityLog.agentId, q.agentId))
          .orderBy(desc(activityLog.createdAt))
          .limit(q.limit)
      : await db
          .select()
          .from(activityLog)
          .orderBy(desc(activityLog.createdAt))
          .limit(q.limit);
    return rows;
  });

  /* ----------------------------- commits ------------------------------- */
  app.get('/api/commits', async (req, reply) => {
    const parsed = parseOr400(commitsQuerySchema, req.query, reply);
    if (!parsed.ok) return;
    const q = parsed.value;

    const rows = q.agentId
      ? await db
          .select()
          .from(commits)
          .where(eq(commits.agentId, q.agentId))
          .orderBy(desc(commits.createdAt))
          .limit(q.limit)
      : await db.select().from(commits).orderBy(desc(commits.createdAt)).limit(q.limit);
    return rows;
  });

  app.get(
    '/api/commits/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const id = req.params.id;
      if (!z.string().uuid().safeParse(id).success) return sendError(reply, 400, 'invalid_id');
      const [commit] = await db.select().from(commits).where(eq(commits.id, id)).limit(1);
      if (!commit) return sendError(reply, 404, 'commit_not_found');

      const agent = commit.agentId
        ? (await db.select().from(agents).where(eq(agents.id, commit.agentId)).limit(1))[0]
        : undefined;
      const cwd = agent?.worktreePath ?? paths.repoRoot;

      // Run git show twice (stat + full patch). Keep outputs truncated so the
      // UI stays responsive even for monster commits.
      const maxBuffer = 8 * 1024 * 1024;
      let stats = '';
      let diff = '';
      try {
        const r1 = await execFileAsync(
          'git',
          ['show', '--stat', '--format=%H%n%an <%ae>%n%ad%n%s%n%n%b', commit.sha],
          { cwd, maxBuffer },
        );
        stats = r1.stdout;
      } catch (err) {
        stats = `(unable to read stats: ${(err as Error).message})`;
      }
      try {
        const r2 = await execFileAsync(
          'git',
          ['show', '--format=', '--patch', commit.sha],
          { cwd, maxBuffer },
        );
        diff = r2.stdout.slice(0, 200_000); // cap
      } catch (err) {
        diff = `(unable to read diff: ${(err as Error).message})`;
      }

      return { ...commit, stats, diff };
    },
  );

  /* ----------------------------- previews ----------------------------- */
  app.get('/api/previews', async () => {
    const rows = await db.select().from(previews).orderBy(desc(previews.createdAt));
    return rows;
  });

  app.delete(
    '/api/previews/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const id = req.params.id;
      if (!z.string().uuid().safeParse(id).success) return sendError(reply, 400, 'invalid_id');
      const [p] = await db.select().from(previews).where(eq(previews.id, id)).limit(1);
      if (!p) return sendError(reply, 404, 'preview_not_found');
      try {
        await stopPreview({
          containerId: p.containerId ?? '',
          projectName: p.projectName ?? undefined,
          workdir: p.workdir,
        });
      } catch (err) {
        logger.warn({ err, id }, 'stopPreview failed');
      }
      await db
        .update(previews)
        .set({ status: 'stopped', stoppedAt: new Date() })
        .where(eq(previews.id, id));
      reply.code(204);
      return;
    },
  );

  /**
   * Bring a stopped preview back online. Rebuilds from the saved workdir (so
   * it still works even if the container was `rm -f`ed) and updates the
   * existing row in place — same `previews.id`, new `host_port` /
   * `container_id`. If the row is already running, we refresh it in place.
   */
  app.post(
    '/api/previews/:id/start',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const id = req.params.id;
      if (!z.string().uuid().safeParse(id).success) return sendError(reply, 400, 'invalid_id');

      const [p] = await db.select().from(previews).where(eq(previews.id, id)).limit(1);
      if (!p) return sendError(reply, 404, 'preview_not_found');

      const agent = p.agentId
        ? (await db.select().from(agents).where(eq(agents.id, p.agentId)).limit(1))[0]
        : undefined;

      // If this preview is already running, stop it first so we don't
      // orphan a container on the port.
      if (p.status === 'running') {
        try {
          await stopPreview({
            containerId: p.containerId ?? '',
            projectName: p.projectName ?? undefined,
            workdir: p.workdir,
          });
        } catch (err) {
          logger.warn({ err, id }, 'pre-start stop failed');
        }
      }

      // Ensure the Docker compose project name is unique so we never
      // collide with another preview from the same agent. If the row was
      // created before we enforced uniqueness, generate a fresh one here.
      const otherUsingSameProject = p.projectName
        ? await db
            .select({ id: previews.id })
            .from(previews)
            .where(
              and(eq(previews.projectName, p.projectName), eq(previews.status, 'running')),
            )
        : [];
      const needsFreshName = !p.projectName || otherUsingSameProject.some((r) => r.id !== id);
      const projectHint = needsFreshName
        ? sanitizeProjectName(
            `agentboard-${agent?.name ?? 'preview'}-${p.name}-${randomUUID().slice(0, 6)}`,
          )
        : p.projectName!;

      try {
        const launched = await launchPreview({
          workdir: p.workdir,
          agentName: agent?.name ?? `preview-${id.slice(0, 8)}`,
          preferredService: p.service ?? undefined,
          projectHint,
        });

        const url = `http://localhost:${launched.hostPort}`;
        const [updated] = await db
          .update(previews)
          .set({
            status: 'running',
            service: launched.service,
            url,
            hostPort: launched.hostPort,
            internalPort: launched.internalPort,
            containerId: launched.containerId,
            projectName: launched.projectName,
            stoppedAt: null,
          })
          .where(eq(previews.id, id))
          .returning();

        await eventBus.emit({
          type: 'activity',
          agentId: p.agentId ?? '00000000-0000-0000-0000-000000000000',
          tool: 'launch_preview',
          at: new Date().toISOString(),
        });

        return updated;
      } catch (err) {
        logger.error({ err, id }, 'POST /api/previews/:id/start failed');
        await db
          .update(previews)
          .set({ status: 'error' })
          .where(eq(previews.id, id));
        return sendError(
          reply,
          500,
          'start_failed',
          err instanceof Error ? err.message : String(err),
        );
      }
    },
  );

  /* --------------------------- approvals ------------------------------ */
  app.get('/api/approvals', async (req) => {
    const q = (req.query ?? {}) as { status?: string };
    const rows = q.status
      ? await db
          .select()
          .from(approvals)
          .where(eq(approvals.status, q.status))
          .orderBy(desc(approvals.createdAt))
      : await db.select().from(approvals).orderBy(desc(approvals.createdAt));
    return rows;
  });

  const resolveApprovalSchema = z.object({
    approved: z.boolean(),
    note: z.string().max(4000).optional(),
  });

  app.post(
    '/api/approvals/:id/resolve',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const id = req.params.id;
      if (!z.string().uuid().safeParse(id).success) return sendError(reply, 400, 'invalid_id');
      const parsed = parseOr400(resolveApprovalSchema, req.body, reply);
      if (!parsed.ok) return;

      const [current] = await db.select().from(approvals).where(eq(approvals.id, id)).limit(1);
      if (!current) return sendError(reply, 404, 'approval_not_found');
      if (current.status !== 'pending') return sendError(reply, 409, 'already_resolved');

      const status = parsed.value.approved ? 'approved' : 'rejected';
      const note = parsed.value.note?.trim() || null;

      const [updated] = await db
        .update(approvals)
        .set({
          status,
          response: note,
          resolvedAt: new Date(),
        })
        .where(eq(approvals.id, id))
        .returning();

      if (!updated) return sendError(reply, 500, 'update_failed');

      // Deliver the answer to the requesting agent's inbox and wake them up.
      if (updated.agentId) {
        const verdict = status === 'approved' ? 'APPROVED' : 'REJECTED';
        const body = [
          `The stakeholder has **${status}** your request:`,
          ``,
          `> ${updated.title}`,
          '',
          note ? `Their note: ${note}` : '(no additional note)',
          '',
          status === 'approved'
            ? 'You may proceed with the plan above.'
            : 'Do not proceed. Reply to the PM with what you\'ll do instead (or ask a new question via request_approval if you need a different path).',
        ].join('\n');

        await db.insert(messages).values({
          fromAgentId: null, // stakeholder
          toAgentId: updated.agentId,
          type: 'answer',
          subject: `${verdict}: ${updated.title}`,
          content: body,
          taskId: updated.taskId,
          deliveredAt: new Date(),
        });
        await enqueueDispatch(updated.agentId);
      }

      await eventBus.emit({
        type: 'approval.resolved',
        approvalId: updated.id,
        agentId: updated.agentId,
        status,
        at: new Date().toISOString(),
      });

      return updated;
    },
  );

  /* ------------------------- GitHub integration ------------------------ */
  app.get('/api/github/status', async () => {
    return getGithubStatus();
  });

  const patSchema = z.object({ token: z.string().min(10).max(400) });
  app.post('/api/github/connect', async (req, reply) => {
    const parsed = parseOr400(patSchema, req.body, reply);
    if (!parsed.ok) return;
    try {
      return await savePersonalAccessToken(parsed.value.token);
    } catch (err) {
      return sendError(reply, 400, 'invalid_token', (err as Error).message);
    }
  });

  app.delete('/api/github/connect', async (_req, reply) => {
    await disconnectPat();
    reply.code(204);
    return;
  });

  /* ------------------- OAuth App flow -------------------
   * Credentials live in app_settings (admin can paste them in /settings)
   * with .env as a fallback for production deploys that prefer config files.
   */
  async function resolveOauthCreds(): Promise<GithubOauthSettings | null> {
    const stored = await getSetting<GithubOauthSettings>('github.oauth');
    if (stored?.clientId && stored?.clientSecret) {
      return {
        clientId: stored.clientId,
        clientSecret: stored.clientSecret,
        redirectUrl: stored.redirectUrl || env.GITHUB_OAUTH_REDIRECT_URL,
      };
    }
    if (env.GITHUB_OAUTH_CLIENT_ID && env.GITHUB_OAUTH_CLIENT_SECRET) {
      return {
        clientId: env.GITHUB_OAUTH_CLIENT_ID,
        clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET,
        redirectUrl: env.GITHUB_OAUTH_REDIRECT_URL,
      };
    }
    return null;
  }

  // Status: tells the UI whether OAuth is configured AND from where.
  // Admins also see the masked clientId; the secret is never returned.
  app.get('/api/github/oauth/config', async (req) => {
    const stored = await getSetting<GithubOauthSettings>('github.oauth');
    const enabled = Boolean(
      (stored?.clientId && stored?.clientSecret) ||
        (env.GITHUB_OAUTH_CLIENT_ID && env.GITHUB_OAUTH_CLIENT_SECRET),
    );
    const source: 'db' | 'env' | null = stored?.clientId
      ? 'db'
      : env.GITHUB_OAUTH_CLIENT_ID
        ? 'env'
        : null;
    const isAdmin = req.user?.role === 'admin';
    return {
      enabled,
      source,
      // Mask the client id — useful to confirm "yes, this is the right App"
      // without re-exposing it in full.
      clientIdMasked:
        isAdmin && stored?.clientId
          ? maskId(stored.clientId)
          : env.GITHUB_OAUTH_CLIENT_ID
            ? maskId(env.GITHUB_OAUTH_CLIENT_ID)
            : null,
      defaultRedirectUrl: env.GITHUB_OAUTH_REDIRECT_URL,
    };
  });

  // Admin sets/replaces credentials from the UI.
  const oauthCredsSchema = z.object({
    clientId: z.string().trim().min(8).max(200),
    clientSecret: z.string().trim().min(8).max(400),
    redirectUrl: z.string().url().optional(),
  });
  app.put('/api/github/oauth/config', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const parsed = parseOr400(oauthCredsSchema, req.body, reply);
    if (!parsed.ok) return;
    await setSetting<GithubOauthSettings>('github.oauth', parsed.value, req.user!.id);
    return { ok: true };
  });

  app.delete('/api/github/oauth/config', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    await deleteSetting('github.oauth');
    return { ok: true };
  });

  // Kicks off the OAuth flow: returns the URL the browser should hop to.
  // We bake `state` into a short-lived cookie so the callback can verify
  // the round-trip and prevent CSRF.
  app.get('/api/github/oauth/start', async (req, reply) => {
    const creds = await resolveOauthCreds();
    if (!creds) {
      return sendError(reply, 412, 'oauth_not_configured', 'Set client id/secret in Settings → GitHub');
    }
    const state = randomUUID();
    reply.setCookie('gh_oauth_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
      secure: process.env.NODE_ENV === 'production',
    });
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', creds.clientId);
    url.searchParams.set('redirect_uri', creds.redirectUrl ?? env.GITHUB_OAUTH_REDIRECT_URL);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', 'repo read:user read:org workflow');
    return { url: url.toString() };
  });

  // GitHub bounces the user back here. We exchange `code` for a token,
  // store it, then send a tiny HTML page that closes the popup or
  // redirects back to /settings.
  app.get('/api/github/oauth/callback', async (req, reply) => {
    const creds = await resolveOauthCreds();
    if (!creds) {
      return reply
        .code(412)
        .header('content-type', 'text/html; charset=utf-8')
        .send(callbackHtml(false, 'OAuth credentials are not configured.'));
    }
    const q = (req.query ?? {}) as { code?: string; state?: string; error?: string };
    if (q.error) {
      return reply
        .code(400)
        .header('content-type', 'text/html; charset=utf-8')
        .send(callbackHtml(false, `GitHub returned an error: ${q.error}`));
    }
    const cookieState = req.cookies?.['gh_oauth_state'];
    if (!q.code || !q.state || !cookieState || q.state !== cookieState) {
      return reply
        .code(400)
        .header('content-type', 'text/html; charset=utf-8')
        .send(callbackHtml(false, 'OAuth state did not match — try again.'));
    }
    reply.clearCookie('gh_oauth_state', { path: '/' });
    try {
      const tok = await exchangeOauthCode(
        q.code,
        creds.redirectUrl ?? env.GITHUB_OAUTH_REDIRECT_URL,
        creds.clientId,
        creds.clientSecret,
      );
      await saveOauthConnection(tok.accessToken, tok.scope, tok.refreshToken);
      logger.info('GitHub OAuth connection stored');
      return reply
        .code(200)
        .header('content-type', 'text/html; charset=utf-8')
        .send(callbackHtml(true));
    } catch (err) {
      logger.warn({ err }, 'OAuth exchange failed');
      return reply
        .code(400)
        .header('content-type', 'text/html; charset=utf-8')
        .send(callbackHtml(false, (err as Error).message));
    }
  });

  app.delete('/api/github/oauth', async (_req, reply) => {
    await disconnectOauth();
    reply.code(204);
    return;
  });

  /* ------------------- GitHub App (manifest + install) ------------------- */
  // What does the UI need to know?
  //   - is a public callback host configured?
  //   - is an App already saved?
  //   - is there an active installation?
  app.get('/api/github/app/config', async (req) => {
    const stored = await getSetting<GithubAppSettings>('github.app');
    const baseUrl = env.PUBLIC_BASE_URL || env.GITHUB_OAUTH_REDIRECT_URL.replace(
      /\/api\/github\/oauth\/callback$/,
      '',
    );
    const webBaseUrl = env.VITE_WEB_URL;
    const isAdmin = req.user?.role === 'admin';
    return {
      configured: Boolean(stored?.appId),
      slug: stored?.slug ?? null,
      htmlUrl: stored?.htmlUrl ?? null,
      installUrl: stored?.slug ? `https://github.com/apps/${stored.slug}/installations/new` : null,
      // Admins see the manifest endpoint URL so they can build the
      // form on the client without us echoing the secrets.
      manifestEndpoint: isAdmin ? '/api/github/app/manifest' : null,
      baseUrl,
      webBaseUrl,
    };
  });

  // Returns the JSON manifest form fields. The UI POSTs them to
  // https://github.com/settings/apps/new?state=…  and GitHub redirects
  // back to /api/github/app/manifest/callback with `code`.
  const manifestPrepSchema = z.object({
    name: z.string().trim().min(3).max(80),
    description: z.string().trim().max(500).optional(),
    organization: z.string().trim().max(80).optional(),
    webhookPublicUrl: z.string().trim().url().optional(),
  });
  app.post('/api/github/app/manifest', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const parsed = parseOr400(manifestPrepSchema, req.body, reply);
    if (!parsed.ok) return;
    const baseUrl =
      env.PUBLIC_BASE_URL ||
      env.GITHUB_OAUTH_REDIRECT_URL.replace(/\/api\/github\/oauth\/callback$/, '');
    const manifest = buildManifest({
      baseUrl,
      webBaseUrl: env.VITE_WEB_URL,
      name: parsed.value.name,
      description: parsed.value.description,
      webhookPublicUrl: parsed.value.webhookPublicUrl,
    });
    const state = randomUUID();
    reply.setCookie('gh_app_manifest_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
      secure: process.env.NODE_ENV === 'production',
    });
    const formAction = parsed.value.organization
      ? `https://github.com/organizations/${encodeURIComponent(parsed.value.organization)}/settings/apps/new?state=${state}`
      : `https://github.com/settings/apps/new?state=${state}`;
    return { manifest: JSON.stringify(manifest), action: formAction, state };
  });

  app.get('/api/github/app/manifest/callback', async (req, reply) => {
    const q = (req.query ?? {}) as { code?: string; state?: string; error?: string };
    if (q.error) {
      return reply
        .code(400)
        .header('content-type', 'text/html; charset=utf-8')
        .send(callbackHtml(false, `GitHub returned an error: ${q.error}`));
    }
    const cookieState = req.cookies?.['gh_app_manifest_state'];
    if (!q.code || !q.state || !cookieState || q.state !== cookieState) {
      return reply
        .code(400)
        .header('content-type', 'text/html; charset=utf-8')
        .send(callbackHtml(false, 'Manifest state did not match — try again.'));
    }
    reply.clearCookie('gh_app_manifest_state', { path: '/' });
    try {
      const created = await exchangeAppManifestCode(q.code);
      logger.info({ slug: created.slug }, 'GitHub App created via manifest');
      return reply
        .code(200)
        .header('content-type', 'text/html; charset=utf-8')
        .send(callbackHtml(true, `App "${created.slug}" created. Now install it on your repos.`));
    } catch (err) {
      logger.warn({ err }, 'Manifest exchange failed');
      return reply
        .code(400)
        .header('content-type', 'text/html; charset=utf-8')
        .send(callbackHtml(false, (err as Error).message));
    }
  });

  // Convenience for the UI to redirect — /apps/<slug>/installations/new
  app.get('/api/github/app/install', async (_req, reply) => {
    const app = await getSetting<GithubAppSettings>('github.app');
    if (!app?.slug) return sendError(reply, 412, 'app_not_configured');
    return reply.redirect(`https://github.com/apps/${app.slug}/installations/new`);
  });

  // GitHub bounces the user back here after they pick the install target
  // (org or personal account) and the repos. We persist installation_id
  // on the github_connections row so subsequent listRepos / clone calls
  // can mint installation tokens.
  app.get('/api/github/app/installation/callback', async (req, reply) => {
    const q = (req.query ?? {}) as {
      installation_id?: string;
      setup_action?: string;
    };
    if (!q.installation_id) {
      return reply
        .code(400)
        .header('content-type', 'text/html; charset=utf-8')
        .send(callbackHtml(false, 'Missing installation_id in callback.'));
    }
    const installationId = Number(q.installation_id);
    if (!Number.isFinite(installationId)) {
      return reply
        .code(400)
        .header('content-type', 'text/html; charset=utf-8')
        .send(callbackHtml(false, 'Invalid installation id.'));
    }
    try {
      // Mint the first installation token to verify the App is wired
      // and to grab a login for the connection row.
      const token = await getInstallationToken(installationId);
      const meRes = await fetch('https://api.github.com/installation/repositories', {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'AgentBoard',
        },
      });
      const meBody = (await meRes.json()) as {
        repositories?: Array<{ owner: { login: string } }>;
      };
      const login = meBody.repositories?.[0]?.owner?.login ?? `installation-${installationId}`;
      const existing = (await db.select().from(githubConnections)).find((r) => r.mode === 'app');
      if (existing) {
        await db
          .update(githubConnections)
          .set({ login, accessToken: token, installationId, scopes: 'app' })
          .where(eq(githubConnections.id, existing.id));
      } else {
        await db.insert(githubConnections).values({
          mode: 'app',
          login,
          accessToken: token,
          installationId,
          scopes: 'app',
        });
      }
      return reply
        .code(200)
        .header('content-type', 'text/html; charset=utf-8')
        .send(callbackHtml(true, 'Installation linked. You can close this tab.'));
    } catch (err) {
      logger.warn({ err }, 'install callback failed');
      return reply
        .code(400)
        .header('content-type', 'text/html; charset=utf-8')
        .send(callbackHtml(false, (err as Error).message));
    }
  });

  app.delete('/api/github/app', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    await db.delete(githubConnections).where(eq(githubConnections.mode, 'app'));
    return { ok: true };
  });

  // Wipe the saved App credentials entirely (admin only). Doesn't touch
  // GitHub itself — the operator still has to delete it there.
  app.delete('/api/github/app/config', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    await deleteSetting('github.app');
    await db.delete(githubConnections).where(eq(githubConnections.mode, 'app'));
    return { ok: true };
  });

  app.get('/api/github/repos', async (req, reply) => {
    const q = (req.query ?? {}) as { limit?: string; owner?: string };
    const limit = q.limit ? Math.min(200, Math.max(1, Number(q.limit))) : 100;
    try {
      const repos = await listRepos({ limit, owner: q.owner });
      return repos;
    } catch (err) {
      return sendError(reply, 502, 'github_failed', (err as Error).message);
    }
  });

  // GitHub accounts the operator can see: own user + orgs (OAuth/PAT)
  // or each App installation account.
  app.get('/api/github/accounts', async (_req, reply) => {
    try {
      return await listAccounts();
    } catch (err) {
      return sendError(reply, 502, 'github_failed', (err as Error).message);
    }
  });

  /* --------------------------- projects ------------------------------- */
  const createProjectSchema = z.object({
    owner: z.string().min(1).max(100),
    repo: z.string().min(1).max(100),
    name: z.string().min(1).max(200).optional(),
    defaultBranch: z.string().min(1).max(120).optional(),
    description: z.string().max(2000).optional(),
    visibility: z.enum(['public', 'private', 'internal']).optional(),
  });

  app.get('/api/projects', async () => {
    const rows = await db.select().from(projects).orderBy(desc(projects.createdAt));
    if (rows.length === 0) return rows;

    // Aggregate cheap, locally-known stats per project so /projects
    // cards can render counts without a per-card request burst.
    const ids = rows.map((r) => r.id);
    const taskRows = await db
      .select({
        projectId: tasks.projectId,
        status: tasks.status,
      })
      .from(tasks)
      .where(inArray(tasks.projectId, ids));
    const previewRows = await db
      .select({ projectName: previews.projectName, status: previews.status })
      .from(previews);
    const commitRows = await db
      .select({
        taskId: commits.taskId,
        createdAt: commits.createdAt,
      })
      .from(commits)
      .orderBy(desc(commits.createdAt))
      .limit(500);
    // map taskId → projectId so we can attribute commits to projects.
    const allTasks = await db
      .select({ id: tasks.id, projectId: tasks.projectId })
      .from(tasks)
      .where(inArray(tasks.projectId, ids));
    const taskToProject = new Map(allTasks.map((t) => [t.id, t.projectId]));

    interface Stats {
      tasksOpen: number;
      tasksTotal: number;
      tasksReview: number;
      runningPreviews: number;
      commits7d: number;
      lastCommitAt: string | null;
    }
    const stats = new Map<string, Stats>();
    for (const r of rows) {
      stats.set(r.id, {
        tasksOpen: 0,
        tasksTotal: 0,
        tasksReview: 0,
        runningPreviews: 0,
        commits7d: 0,
        lastCommitAt: null,
      });
    }

    for (const t of taskRows) {
      if (!t.projectId) continue;
      const s = stats.get(t.projectId);
      if (!s) continue;
      s.tasksTotal += 1;
      if (t.status === 'in_progress' || t.status === 'todo') s.tasksOpen += 1;
      if (t.status === 'review') s.tasksReview += 1;
    }

    for (const p of previewRows) {
      if (!p.projectName) continue;
      // The project name we store on previews is the docker compose
      // project name, not the AgentBoard project. Skip — counted in
      // /api/previews directly.
    }

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const c of commitRows) {
      if (!c.taskId) continue;
      const projectId = taskToProject.get(c.taskId);
      if (!projectId) continue;
      const s = stats.get(projectId);
      if (!s) continue;
      const ts = c.createdAt instanceof Date ? c.createdAt.getTime() : Date.parse(String(c.createdAt));
      if (ts > sevenDaysAgo) s.commits7d += 1;
      if (!s.lastCommitAt || (c.createdAt instanceof Date && ts > Date.parse(s.lastCommitAt))) {
        s.lastCommitAt = c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt);
      }
    }

    return rows.map((r) => ({ ...r, stats: stats.get(r.id) ?? null }));
  });

  app.post('/api/projects', async (req, reply) => {
    const parsed = parseOr400(createProjectSchema, req.body, reply);
    if (!parsed.ok) return;
    const body = parsed.value;

    try {
      // Clone up front so the UI shows failure fast instead of during the
      // first turn of an agent.
      const clonePath = await cloneRepo(body.owner, body.repo, {
        branch: body.defaultBranch,
      });

      const [created] = await db
        .insert(projects)
        .values({
          name: body.name ?? `${body.owner}/${body.repo}`,
          repoOwner: body.owner,
          repoName: body.repo,
          defaultBranch: body.defaultBranch ?? 'main',
          clonePath,
          visibility: body.visibility === 'public' ? 'public' : 'private',
          description: body.description ?? null,
        })
        .returning();

      reply.code(201);
      return created;
    } catch (err) {
      logger.error({ err, body }, 'POST /api/projects failed');
      return sendError(reply, 500, 'create_failed', (err as Error).message);
    }
  });

  app.get(
    '/api/projects/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const id = req.params.id;
      if (!z.string().uuid().safeParse(id).success) return sendError(reply, 400, 'invalid_id');
      const [row] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
      if (!row) return sendError(reply, 404, 'project_not_found');
      const projectTasks = await db
        .select()
        .from(tasks)
        .where(eq(tasks.projectId, id))
        .orderBy(desc(tasks.createdAt));
      return { ...row, tasks: projectTasks };
    },
  );

  app.get(
    '/api/projects/:id/pulls',
    async (
      req: FastifyRequest<{ Params: { id: string }; Querystring: { state?: string } }>,
      reply,
    ) => {
      const id = req.params.id;
      if (!z.string().uuid().safeParse(id).success) return sendError(reply, 400, 'invalid_id');
      const [p] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
      if (!p) return sendError(reply, 404, 'project_not_found');
      const state = (req.query.state ?? 'all') as 'open' | 'closed' | 'all';
      try {
        return await listPullRequests(p.repoOwner, p.repoName, state, 100);
      } catch (err) {
        return sendError(reply, 502, 'gh_failed', (err as Error).message);
      }
    },
  );

  app.get(
    '/api/projects/:id/issues',
    async (
      req: FastifyRequest<{ Params: { id: string }; Querystring: { state?: string } }>,
      reply,
    ) => {
      const id = req.params.id;
      if (!z.string().uuid().safeParse(id).success) return sendError(reply, 400, 'invalid_id');
      const [p] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
      if (!p) return sendError(reply, 404, 'project_not_found');
      const state = (req.query.state ?? 'open') as 'open' | 'closed' | 'all';
      try {
        return await listIssues(p.repoOwner, p.repoName, state, 100);
      } catch (err) {
        return sendError(reply, 502, 'gh_failed', (err as Error).message);
      }
    },
  );

  app.get(
    '/api/projects/:id/branches',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const id = req.params.id;
      if (!z.string().uuid().safeParse(id).success) return sendError(reply, 400, 'invalid_id');
      const [p] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
      if (!p) return sendError(reply, 404, 'project_not_found');
      if (!p.clonePath) return sendError(reply, 409, 'clone_missing');
      try {
        return await listProjectBranches(p.clonePath, p.defaultBranch);
      } catch (err) {
        return sendError(reply, 500, 'branches_failed', (err as Error).message);
      }
    },
  );

  /**
   * Import a GitHub issue as an AgentBoard task. Creates a stakeholder-owned
   * task bound to the project. Default assignee is the PM agent if one
   * exists, so the team kicks off planning.
   */
  app.post(
    '/api/projects/:id/issues/:number/import',
    async (
      req: FastifyRequest<{ Params: { id: string; number: string }; Body: { assigneeId?: string | null } }>,
      reply,
    ) => {
      const id = req.params.id;
      if (!z.string().uuid().safeParse(id).success) return sendError(reply, 400, 'invalid_id');
      const number = Number(req.params.number);
      if (!Number.isFinite(number) || number <= 0)
        return sendError(reply, 400, 'invalid_issue_number');

      const [p] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
      if (!p) return sendError(reply, 404, 'project_not_found');

      const issue = await getIssue(p.repoOwner, p.repoName, number);
      if (!issue) return sendError(reply, 404, 'issue_not_found');

      let assigneeId = req.body?.assigneeId ?? null;
      if (!assigneeId) {
        const [pm] = await db
          .select()
          .from(agents)
          .where(eq(agents.role, 'pm'))
          .limit(1);
        if (pm) assigneeId = pm.id;
      }

      const description = [
        issue.body ? issue.body.trim() : '',
        '',
        '---',
        `Imported from ${issue.url}`,
        `Labels: ${issue.labels.join(', ') || '—'}`,
      ].join('\n');

      const [created] = await db
        .insert(tasks)
        .values({
          projectId: p.id,
          title: `#${issue.number}: ${issue.title}`,
          description,
          status: 'todo',
          assigneeId,
          createdBy: null,
          priority: 3,
        })
        .returning();

      if (!created) return sendError(reply, 500, 'insert_failed');

      // Wake the assignee so they pick it up.
      if (assigneeId) {
        await db.insert(messages).values({
          fromAgentId: null,
          toAgentId: assigneeId,
          type: 'assignment',
          subject: `Issue imported: ${issue.title}`,
          content: `Stakeholder imported GitHub issue #${issue.number} from ${p.repoOwner}/${p.repoName}.\n\nTitle: ${issue.title}\n\nTask ID: ${created.id}\nIssue URL: ${issue.url}`,
          taskId: created.id,
          deliveredAt: new Date(),
        });
        await enqueueDispatch(assigneeId);
      }

      await eventBus.emit({
        type: 'task.created',
        taskId: created.id,
        title: created.title,
        at: new Date().toISOString(),
      });

      reply.code(201);
      return created;
    },
  );

  app.delete(
    '/api/projects/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const id = req.params.id;
      if (!z.string().uuid().safeParse(id).success) return sendError(reply, 400, 'invalid_id');
      const [row] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
      if (!row) return sendError(reply, 404, 'project_not_found');
      // Detach any tasks referencing it so we don't FK-fail
      await db.update(tasks).set({ projectId: null }).where(eq(tasks.projectId, id));
      await db.delete(projects).where(eq(projects.id, id));
      reply.code(204);
      return;
    },
  );

  /* ----------------------------- replay ------------------------------ */
  app.get(
    '/api/tasks/:id/replay',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const id = req.params.id;
      if (!z.string().uuid().safeParse(id).success) return sendError(reply, 400, 'invalid_id');
      const [task] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
      if (!task) return sendError(reply, 404, 'task_not_found');

      const [msgs, acts, cmts] = await Promise.all([
        db.select().from(messages).where(eq(messages.taskId, id)).orderBy(asc(messages.createdAt)),
        db
          .select()
          .from(activityLog)
          .orderBy(asc(activityLog.createdAt))
          .limit(2000),
        db.select().from(commits).where(eq(commits.taskId, id)).orderBy(asc(commits.createdAt)),
      ]);

      const events: Array<Record<string, unknown>> = [];
      for (const m of msgs) {
        events.push({
          kind: 'message',
          at: m.createdAt,
          agentId: m.fromAgentId ?? null,
          payload: { type: m.type, subject: m.subject, content: m.content, to: m.toAgentId },
        });
      }
      // Activity log doesn't carry taskId — narrow via timing window of the
      // task (createdAt → max(updatedAt, latest commit/message)).
      const start = new Date(task.createdAt).getTime();
      const stops = [
        new Date(task.updatedAt).getTime(),
        ...msgs.map((m) => new Date(m.createdAt).getTime()),
        ...cmts.map((c) => new Date(c.createdAt).getTime()),
      ];
      const end = stops.length ? Math.max(...stops) : Date.now();

      const taskAgents = new Set<string>();
      if (task.assigneeId) taskAgents.add(task.assigneeId);
      for (const m of msgs) {
        if (m.fromAgentId) taskAgents.add(m.fromAgentId);
        if (m.toAgentId) taskAgents.add(m.toAgentId);
      }

      for (const a of acts) {
        const ts = new Date(a.createdAt).getTime();
        if (ts < start - 30_000 || ts > end + 30_000) continue;
        if (a.agentId && !taskAgents.has(a.agentId)) continue;
        events.push({
          kind: 'activity',
          at: a.createdAt,
          agentId: a.agentId,
          payload: { eventType: a.eventType, ...a.payload },
        });
      }
      for (const c of cmts) {
        events.push({
          kind: 'commit',
          at: c.createdAt,
          agentId: c.agentId,
          payload: {
            sha: c.sha,
            message: c.message,
            branch: c.branch,
            filesChanged: c.filesChanged,
          },
        });
      }
      events.sort((a, b) => new Date(a.at as string).getTime() - new Date(b.at as string).getTime());
      return { task, events };
    },
  );

  /* --------------------------- notifications ------------------------- */
  app.get('/api/notifications', async () => {
    return db.select().from(notifications).orderBy(desc(notifications.createdAt));
  });

  const createNotificationSchema = z.object({
    label: z.string().min(1).max(200),
    targetUrl: z.string().url().max(1000),
    kinds: z.array(z.string()).default([]),
    enabled: z.boolean().default(true),
    template: z.enum(['slack', 'generic']).default('slack'),
  });
  app.post('/api/notifications', async (req, reply) => {
    const parsed = parseOr400(createNotificationSchema, req.body, reply);
    if (!parsed.ok) return;
    const [created] = await db
      .insert(notifications)
      .values(parsed.value)
      .returning();
    reply.code(201);
    return created;
  });
  app.delete(
    '/api/notifications/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const id = req.params.id;
      if (!z.string().uuid().safeParse(id).success) return sendError(reply, 400, 'invalid_id');
      await db.delete(notifications).where(eq(notifications.id, id));
      reply.code(204);
      return;
    },
  );
  app.post(
    '/api/notifications/:id/test',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const id = req.params.id;
      if (!z.string().uuid().safeParse(id).success) return sendError(reply, 400, 'invalid_id');
      const [n] = await db.select().from(notifications).where(eq(notifications.id, id)).limit(1);
      if (!n) return sendError(reply, 404, 'notification_not_found');
      try {
        const payload =
          n.template === 'generic'
            ? { kind: 'agentboard.test', at: new Date().toISOString() }
            : { text: 'AgentBoard test notification — wiring works.' };
        const r = await fetch(n.targetUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        return { ok: r.ok, status: r.status };
      } catch (err) {
        return sendError(reply, 502, 'webhook_failed', (err as Error).message);
      }
    },
  );

  /* ------------------------------ audit ------------------------------- */
  app.get('/api/audit', async (req) => {
    const q = (req.query ?? {}) as { limit?: string };
    const limit = q.limit ? Math.min(500, Math.max(1, Number(q.limit))) : 200;
    const rows = await db
      .select()
      .from(auditEvents)
      .orderBy(desc(auditEvents.id))
      .limit(limit);
    return rows;
  });
  app.get('/api/audit/verify', async () => {
    return verifyAuditChain();
  });

  /* ----------------------- usage / budgets ---------------------------- */
  app.get('/api/usage', async () => {
    return spendSummary();
  });
  // Back-compat alias — kept for clients that still hit /api/spend.
  app.get('/api/spend', async () => {
    return spendSummary();
  });

  app.get('/api/usage/pricing', async () => {
    return listModelsWithPricing();
  });
  app.get('/api/spend/pricing', async () => {
    return listModelsWithPricing();
  });

  const patchBudgetSchema = z.object({
    dailyCostCapMicroUsd: z.number().int().min(0).max(10_000_000_000).nullable().optional(),
    totalCostCapMicroUsd: z.number().int().min(0).max(10_000_000_000).nullable().optional(),
  });
  app.patch(
    '/api/agents/:id/budget',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const id = req.params.id;
      if (!z.string().uuid().safeParse(id).success) return sendError(reply, 400, 'invalid_id');
      const parsed = parseOr400(patchBudgetSchema, req.body, reply);
      if (!parsed.ok) return;
      const [updated] = await db
        .update(agents)
        .set(parsed.value)
        .where(eq(agents.id, id))
        .returning();
      if (!updated) return sendError(reply, 404, 'agent_not_found');
      return updated;
    },
  );

  /* ------------------------ agent-status util -------------------------- */
  app.patch(
    '/api/agents/:id/status',
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: { status: string } }>,
      reply,
    ) => {
      const id = req.params.id;
      if (!z.string().uuid().safeParse(id).success) return sendError(reply, 400, 'invalid_id');
      const parsed = parseOr400(z.object({ status: AgentStatusSchema }), req.body, reply);
      if (!parsed.ok) return;
      const [updated] = await db
        .update(agents)
        .set({ status: parsed.value.status })
        .where(eq(agents.id, id))
        .returning();
      if (!updated) return sendError(reply, 404, 'agent_not_found');
      await eventBus.emit({
        type: 'agent.status',
        agentId: id,
        status: parsed.value.status,
        at: new Date().toISOString(),
      });
      return updated;
    },
  );
}

/* ────────────── OAuth callback HTML helper ──────────────
 * Tiny self-closing page rendered when GitHub bounces the user back to
 * /api/github/oauth/callback. If we're a popup we postMessage the result
 * and close; otherwise we redirect back to /settings.
 */
function maskId(id: string): string {
  if (id.length <= 8) return '****';
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function callbackHtml(success: boolean, error?: string): string {
  const safeError = (error ?? '').replace(/[<&"']/g, (c) =>
    c === '<' ? '&lt;' : c === '&' ? '&amp;' : c === '"' ? '&quot;' : '&#39;',
  );
  // Always redirect to the WEB app (env.VITE_WEB_URL). Using a relative
  // /settings would resolve against the orchestrator's host (3001) and
  // 404 — that's the bug we hit before. JSON-encode so weird hosts in
  // env can't break the inline string.
  const webSettingsUrl = JSON.stringify(`${env.VITE_WEB_URL.replace(/\/$/, '')}/settings`);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${success ? 'Connected' : 'Connection failed'}</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0b0b0c; color: #e5e5e5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .card { max-width: 420px; padding: 28px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.02); text-align: center; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p { color: #a0a0a0; font-size: 13px; margin: 0 0 16px; }
  .ok { color: #79e0a3; }
  .err { color: #ff8080; }
  a { color: #ff8c33; }
</style></head>
<body>
  <div class="card">
    <h1 class="${success ? 'ok' : 'err'}">${success ? 'GitHub connected' : 'Connection failed'}</h1>
    <p>${success ? 'You can close this tab and return to AgentBoard.' : safeError || 'See server logs.'}</p>
    <a href=${webSettingsUrl}>Back to AgentBoard →</a>
  </div>
  <script>
    var webSettings = ${webSettingsUrl};
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'agentboard:oauth', success: ${success ? 'true' : 'false'} }, '*');
        setTimeout(function () { try { window.close(); } catch (e) {} }, 800);
        // Belt + braces: if the popup didn't close (some browsers refuse
        // when opener is cross-origin), fall back to the redirect.
        setTimeout(function () { try { location.href = webSettings; } catch (e) {} }, 1500);
      } else {
        setTimeout(function () { location.href = webSettings; }, 1200);
      }
    } catch (e) { location.href = webSettings; }
  </script>
</body></html>`;
}
