import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { db } from '../../db/client.js';
import { tasks, messages } from '../../db/schema.js';
import { enqueueDispatch } from '../../redis/streams.js';
import { eventBus } from '../../events/bus.js';
import { err, ok, resolveAgentByNameOrId } from '../helpers.js';
import { logger } from '../../logger.js';

const schema = {
  taskId: z.string().uuid(),
  reviewerName: z.string().min(1).describe('Agent name or id to review the task'),
  note: z.string().optional().describe('Short note for the reviewer'),
};

export function requestReviewTool(currentAgentId: string) {
  return tool(
    'request_review',
    "Move a task into 'review' status and notify a specific reviewer (typically QA). Creates a review message that wakes the reviewer.",
    schema,
    async (args) => {
      try {
        const reviewer = await resolveAgentByNameOrId(args.reviewerName);
        if (!reviewer) return err(`Reviewer "${args.reviewerName}" not found`);

        const [updatedTask] = await db
          .update(tasks)
          .set({ status: 'review', updatedAt: new Date() })
          .where(eq(tasks.id, args.taskId))
          .returning();

        if (!updatedTask) return err(`Task ${args.taskId} not found`);

        const [msg] = await db
          .insert(messages)
          .values({
            fromAgentId: currentAgentId,
            toAgentId: reviewer.id,
            type: 'review',
            taskId: updatedTask.id,
            subject: `Review requested: ${updatedTask.title}`,
            content: args.note ?? `Please review task "${updatedTask.title}" (${updatedTask.id}).`,
            deliveredAt: new Date(),
          })
          .returning();

        await enqueueDispatch(reviewer.id);

        await eventBus.emit({
          type: 'task.updated',
          taskId: updatedTask.id,
          status: 'review',
          assigneeId: updatedTask.assigneeId,
          at: new Date().toISOString(),
        });

        if (msg) {
          await eventBus.emit({
            type: 'message.sent',
            messageId: msg.id,
            fromAgentId: currentAgentId,
            toAgentId: reviewer.id,
            messageType: 'review',
            subject: msg.subject ?? 'Review requested',
            at: new Date().toISOString(),
          });
        }

        return ok(`Requested review of task ${updatedTask.id} from ${reviewer.name}.`);
      } catch (e) {
        logger.error({ err: e, currentAgentId }, 'request_review tool failed');
        return err(`request_review failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
}
