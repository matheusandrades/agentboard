import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { TaskStatusSchema } from '@agentboard/shared';
import { db } from '../../db/client.js';
import { tasks } from '../../db/schema.js';
import { eventBus } from '../../events/bus.js';
import { enqueueDispatch } from '../../redis/streams.js';
import { err, ok, resolveAgentByNameOrId } from '../helpers.js';
import { logger } from '../../logger.js';

const schema = {
  taskId: z.string().uuid(),
  status: TaskStatusSchema.optional(),
  assigneeName: z.string().optional().describe('Agent name or id; pass empty string to unassign'),
  description: z.string().optional(),
  title: z.string().max(500).optional(),
  priority: z.number().int().min(1).max(5).optional(),
};

export function updateTaskTool(currentAgentId: string) {
  return tool(
    'update_task',
    'Move a task between columns, reassign, or update its text. Only provided fields are changed.',
    schema,
    async (args) => {
      try {
        const patch: Partial<typeof tasks.$inferInsert> = {};
        if (args.status !== undefined) patch.status = args.status;
        if (args.description !== undefined) patch.description = args.description;
        if (args.title !== undefined) patch.title = args.title;
        if (args.priority !== undefined) patch.priority = args.priority;
        patch.updatedAt = new Date();

        let assigneeId: string | null | undefined = undefined;
        if (args.assigneeName !== undefined) {
          if (args.assigneeName === '') {
            assigneeId = null;
          } else {
            const a = await resolveAgentByNameOrId(args.assigneeName);
            if (!a) return err(`Assignee "${args.assigneeName}" not found`);
            assigneeId = a.id;
          }
          patch.assigneeId = assigneeId;
        }

        const [updated] = await db
          .update(tasks)
          .set(patch)
          .where(eq(tasks.id, args.taskId))
          .returning();

        if (!updated) return err(`Task ${args.taskId} not found`);

        await eventBus.emit({
          type: 'task.updated',
          taskId: updated.id,
          status: updated.status as never,
          assigneeId: updated.assigneeId,
          at: new Date().toISOString(),
        });

        // If reassigned, wake the new assignee.
        if (assigneeId) await enqueueDispatch(assigneeId);

        return ok(`Updated task ${updated.id} (status=${updated.status}).`);
      } catch (e) {
        logger.error({ err: e, currentAgentId }, 'update_task tool failed');
        return err(`update_task failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
}
