import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { db } from '../../db/client.js';
import { messages } from '../../db/schema.js';
import { enqueueDispatch } from '../../redis/streams.js';
import { eventBus } from '../../events/bus.js';
import { err, ok, resolveAgentByNameOrId } from '../helpers.js';
import { logger } from '../../logger.js';

const schema = {
  to: z.string().min(1).describe('Agent name or id to ask'),
  subject: z.string().min(1).max(500),
  content: z.string().min(1).describe('Your question'),
  threadId: z.string().uuid().optional().describe('Reuse a thread id to keep the conversation linked'),
  taskId: z.string().uuid().optional(),
};

export function askAgentTool(currentAgentId: string) {
  return tool(
    'ask_agent',
    "Ask another agent a question. Like send_message but type='question' and always thread-tracked (a thread id is generated if you don't pass one).",
    schema,
    async (args) => {
      try {
        const target = await resolveAgentByNameOrId(args.to);
        if (!target) return err(`Agent "${args.to}" not found`);

        const threadId = args.threadId ?? randomUUID();

        const [inserted] = await db
          .insert(messages)
          .values({
            fromAgentId: currentAgentId,
            toAgentId: target.id,
            threadId,
            taskId: args.taskId ?? null,
            type: 'question',
            subject: args.subject,
            content: args.content,
            deliveredAt: new Date(),
          })
          .returning();

        if (!inserted) return err('Failed to insert message');

        await enqueueDispatch(target.id);

        await eventBus.emit({
          type: 'message.sent',
          messageId: inserted.id,
          fromAgentId: currentAgentId,
          toAgentId: target.id,
          messageType: 'question',
          subject: args.subject,
          at: new Date().toISOString(),
        });

        return ok(`Asked ${target.name}: "${args.subject}" (thread=${threadId}, id=${inserted.id})`);
      } catch (e) {
        logger.error({ err: e, currentAgentId }, 'ask_agent tool failed');
        return err(`ask_agent failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
}
