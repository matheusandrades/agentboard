import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { TaskStatusSchema } from '@agentboard/shared';
import { db } from '../../db/client.js';
import { messages, sprints, tasks } from '../../db/schema.js';
import { eventBus } from '../../events/bus.js';
import { enqueueDispatch } from '../../redis/streams.js';
import { err, ok, resolveAgentByNameOrId } from '../helpers.js';
import { logger } from '../../logger.js';

const schema = {
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  assignee: z.string().optional().describe('Agent name or id to assign the task to'),
  priority: z.number().int().min(1).max(5).optional().describe('1 (highest) to 5 (lowest)'),
  parentTaskId: z.string().uuid().optional(),
  sprintId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional().describe('GitHub project to attach this task to'),
  status: TaskStatusSchema.optional(),
};

export function createTaskTool(currentAgentId: string) {
  return tool(
    'create_task',
    'Create a Kanban task. Optionally assigns it to another agent (who will be notified via the dispatch queue).',
    schema,
    async (args) => {
      try {
        let assigneeId: string | null = null;
        if (args.assignee) {
          const a = await resolveAgentByNameOrId(args.assignee);
          if (!a) return err(`Assignee "${args.assignee}" not found`);
          assigneeId = a.id;
        }

        // If the caller didn't pin a sprint, default to the currently active
        // one so tasks don't fall into an unscoped "All" bucket.
        let sprintId: string | null = args.sprintId ?? null;
        if (!sprintId) {
          const [active] = await db
            .select()
            .from(sprints)
            .where(eq(sprints.status, 'active'))
            .limit(1);
          if (active) sprintId = active.id;
        }

        const [created] = await db
          .insert(tasks)
          .values({
            title: args.title,
            description: args.description ?? null,
            status: args.status ?? 'backlog',
            assigneeId,
            createdBy: currentAgentId,
            priority: args.priority ?? 3,
            parentId: args.parentTaskId ?? null,
            sprintId,
            projectId: args.projectId ?? null,
          })
          .returning();

        if (!created) return err('Failed to insert task');

        await eventBus.emit({
          type: 'task.created',
          taskId: created.id,
          title: created.title,
          at: new Date().toISOString(),
        });

        // If the task has an assignee, auto-drop a briefing into their inbox
        // and wake them. Without this, the dispatcher fires for the assignee
        // but their inbox is empty, so the runner skips the turn and they
        // never learn about the task.
        if (assigneeId) {
          const body = [
            `You've been assigned a new task.`,
            ``,
            `Title: ${created.title}`,
            created.description ? `\n${created.description}` : '',
            `\nTask ID: ${created.id}`,
            `Priority: P${created.priority}`,
            `Status: ${created.status}`,
            ``,
            `Read the task on the kanban, break it down if needed, do the work,`,
            `commit your code with a clear message, and move the task through`,
            `the kanban (in_progress → review → done). Reply to the PM with a`,
            `status update when you finish or if you're blocked.`,
          ].join('\n');

          const [notification] = await db
            .insert(messages)
            .values({
              fromAgentId: currentAgentId,
              toAgentId: assigneeId,
              type: 'assignment',
              subject: `Task assigned: ${created.title}`,
              content: body,
              taskId: created.id,
              deliveredAt: new Date(),
            })
            .returning();

          if (notification) {
            await eventBus.emit({
              type: 'message.sent',
              messageId: notification.id,
              fromAgentId: currentAgentId,
              toAgentId: assigneeId,
              messageType: 'assignment',
              subject: notification.subject ?? '',
              at: new Date().toISOString(),
            });
          }

          await enqueueDispatch(assigneeId);
        }

        return ok(`Created task ${created.id}: "${created.title}" (status=${created.status}).`);
      } catch (e) {
        logger.error({ err: e, currentAgentId }, 'create_task tool failed');
        return err(`create_task failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
}
