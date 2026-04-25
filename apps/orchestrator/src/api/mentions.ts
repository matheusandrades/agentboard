/**
 * Backing search for the chat's @-mention autocomplete.
 *
 * GET /api/mentions/search?q=foo&types=agent,task,commit&projectId=<uuid>
 *
 * Returns a flat ranked list of candidates the UI can drop into a popup
 * (Cursor / Linear / GitHub-style). Keeping it server-side lets us stay
 * consistent across surfaces (Chat page, floating ChatLauncher, agent
 * inbox replies later) and apply RBAC if needed.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { agents, commits, tasks } from '../db/schema.js';

export interface MentionCandidate {
  type: 'agent' | 'task' | 'commit';
  /** What the user types to insert it (e.g. `@alice-pm`, `#abc1234`). */
  token: string;
  /** Human label shown in the popup. */
  label: string;
  /** Secondary detail line (role, status, etc.). */
  subtitle?: string;
  /** Underlying entity id when relevant — useful for hover-cards later. */
  refId?: string;
}

const querySchema = z.object({
  q: z.string().trim().max(100).default(''),
  types: z.string().optional(),
  projectId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(15),
});

export async function registerMentionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/mentions/search', async (req, reply) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid' });
    const { q, types: typesRaw, projectId, limit } = parsed.data;
    const set = new Set(
      (typesRaw ?? 'agent,task,commit')
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    );

    const out: MentionCandidate[] = [];
    const like = q ? `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%` : '%';

    if (set.has('agent')) {
      const rows = await db
        .select()
        .from(agents)
        .where(or(ilike(agents.name, like), ilike(agents.role, like)))
        .limit(limit);
      for (const a of rows) {
        out.push({
          type: 'agent',
          token: `@${a.name}`,
          label: a.name,
          subtitle: a.role,
          refId: a.id,
        });
      }
    }

    if (set.has('task')) {
      const condParts = [or(ilike(tasks.title, like), ilike(tasks.description, like))];
      if (projectId) condParts.push(eq(tasks.projectId, projectId));
      const rows = await db
        .select()
        .from(tasks)
        .where(and(...condParts))
        .orderBy(desc(tasks.updatedAt))
        .limit(limit);
      for (const t of rows) {
        out.push({
          type: 'task',
          token: `#task-${t.id.slice(0, 8)}`,
          label: t.title,
          subtitle: `${t.status}${t.branch ? ` · ${t.branch.split('/').pop()}` : ''}`,
          refId: t.id,
        });
      }
    }

    if (set.has('commit')) {
      // Substring match on sha (short or full) AND on message body.
      const rows = await db
        .select()
        .from(commits)
        .where(or(ilike(commits.sha, like), ilike(commits.message, like)))
        .orderBy(desc(commits.createdAt))
        .limit(limit);
      for (const c of rows) {
        out.push({
          type: 'commit',
          token: `[commit:${c.sha.slice(0, 7)}]`,
          label: `${c.sha.slice(0, 7)} ${c.message ?? ''}`.trim(),
          subtitle: c.branch ?? undefined,
          refId: c.id,
        });
      }
    }

    return out.slice(0, limit);
  });
}
