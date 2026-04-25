import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { db } from '../../db/client.js';
import { agents, previews } from '../../db/schema.js';
import { launchPreview, sanitizeProjectName, stopPreview } from '../../worktree/docker.js';
import { eventBus } from '../../events/bus.js';
import { err, ok } from '../helpers.js';
import { logger } from '../../logger.js';

const launchSchema = {
  name: z.string().optional().describe('Short human-readable name for the preview (e.g. "Hello World v1")'),
  service: z
    .string()
    .optional()
    .describe('Compose service name to pick if multiple have exposed ports'),
  taskId: z.string().uuid().optional().describe('Related task id so the UI can link them together'),
};

/**
 * Build and start the agent's current workdir as a Docker container. The
 * worktree must contain a Dockerfile or docker-compose.yml. On success we
 * record the mapped host port in the `previews` table and return the URL
 * so the agent can share it with the PM / stakeholder.
 */
export function launchPreviewTool(currentAgentId: string) {
  return tool(
    'launch_preview',
    `Build and run the agent's worktree as a Docker container so a reviewer can open the app in a browser. Assumes a Dockerfile or docker-compose.yml exists in the worktree. Returns the URL.`,
    launchSchema,
    async (args) => {
      try {
        const [agent] = await db.select().from(agents).where(eq(agents.id, currentAgentId)).limit(1);
        if (!agent) return err('agent not found');
        if (!agent.worktreePath) return err('agent has no worktree yet; try committing work first');

        // If a running preview already exists for this agent (+optional task),
        // stop it first so we don't leak containers on every retry.
        const where = args.taskId
          ? and(
              eq(previews.agentId, agent.id),
              eq(previews.taskId, args.taskId),
              eq(previews.status, 'running'),
            )
          : and(eq(previews.agentId, agent.id), eq(previews.status, 'running'));
        const existing = await db.select().from(previews).where(where);
        for (const p of existing) {
          try {
            await stopPreview({
              containerId: p.containerId ?? '',
              projectName: p.projectName ?? undefined,
              workdir: p.workdir,
            });
          } catch {
            /* best effort */
          }
          await db
            .update(previews)
            .set({ status: 'stopped', stoppedAt: new Date() })
            .where(eq(previews.id, p.id));
        }

        // Make the Docker compose project name UNIQUE per preview so a second
        // preview for the same agent doesn't recreate the first one's
        // containers (Docker would see the same project+service pair and
        // replace them in place, leaving the old preview row pointing at a
        // port with nothing behind it).
        const shortTag = randomUUID().slice(0, 6);
        const hint = sanitizeProjectName(
          `agentboard-${agent.name}-${args.name ?? 'preview'}-${shortTag}`,
        );

        const launched = await launchPreview({
          workdir: agent.worktreePath,
          agentName: agent.name,
          preferredService: args.service,
          projectHint: hint,
        });

        const url = `http://localhost:${launched.hostPort}`;
        const [row] = await db
          .insert(previews)
          .values({
            agentId: agent.id,
            taskId: args.taskId ?? null,
            name: args.name ?? `${agent.name} preview`,
            service: launched.service,
            workdir: launched.workdir,
            url,
            hostPort: launched.hostPort,
            internalPort: launched.internalPort,
            containerId: launched.containerId,
            projectName: launched.projectName,
            status: 'running',
          })
          .returning();

        if (row) {
          await eventBus.emit({
            type: 'activity',
            agentId: agent.id,
            tool: 'launch_preview',
            at: new Date().toISOString(),
          });
        }

        return ok(
          `Preview is live at ${url} (container=${launched.containerId.slice(0, 12)}, port=${launched.hostPort}). Tell the PM or stakeholder to open it.`,
        );
      } catch (e) {
        logger.error({ err: e, currentAgentId }, 'launch_preview tool failed');
        return err(`launch_preview failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
}

/* ────────────────────────── stop_preview ───────────────────────── */

const stopSchema = {
  previewId: z.string().uuid().optional().describe('Specific preview id to stop'),
};

export function stopPreviewTool(currentAgentId: string) {
  return tool(
    'stop_preview',
    `Stop a running Docker preview. Without args, stops all running previews owned by the current agent.`,
    stopSchema,
    async (args) => {
      try {
        const where = args.previewId
          ? eq(previews.id, args.previewId)
          : and(eq(previews.agentId, currentAgentId), eq(previews.status, 'running'));
        const rows = await db.select().from(previews).where(where);
        if (rows.length === 0) return ok('no running previews to stop.');

        for (const p of rows) {
          try {
            await stopPreview({
              containerId: p.containerId ?? '',
              projectName: p.projectName ?? undefined,
              workdir: p.workdir,
            });
          } catch (e) {
            logger.warn({ err: e, preview: p.id }, 'stopPreview failed');
          }
          await db
            .update(previews)
            .set({ status: 'stopped', stoppedAt: new Date() })
            .where(eq(previews.id, p.id));
        }

        return ok(`stopped ${rows.length} preview(s).`);
      } catch (e) {
        logger.error({ err: e, currentAgentId }, 'stop_preview tool failed');
        return err(`stop_preview failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
}
