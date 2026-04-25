import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { MessageTypeSchema } from '@agentboard/shared';
import { db } from '../../db/client.js';
import { messages } from '../../db/schema.js';
import { enqueueDispatch } from '../../redis/streams.js';
import { eventBus } from '../../events/bus.js';
import { err, ok, resolveAgentByNameOrId } from '../helpers.js';
import { notePairExchange } from '../../lib/locks.js';
import { logger } from '../../logger.js';

const schema = {
  to: z.string().min(1).describe('Target agent name (e.g. "alice-pm") or "*" for broadcast'),
  type: MessageTypeSchema.describe('Message type'),
  subject: z.string().min(1).max(500).describe('Short subject line'),
  content: z.string().min(1).describe('Full message body — becomes the prompt when the recipient next runs'),
  taskId: z.string().uuid().optional().describe('Related task id'),
  threadId: z.string().uuid().optional().describe('Thread id for follow-ups'),
};

export function sendMessageTool(currentAgentId: string) {
  return tool(
    'send_message',
    'Send a message to another agent (or broadcast with to="*"). The recipient will wake up on the dispatcher and read this as their next prompt.',
    schema,
    async (args) => {
      try {
        let toAgentId: string | null = null;
        if (args.to !== '*') {
          const target = await resolveAgentByNameOrId(args.to);
          if (!target) return err(`Recipient "${args.to}" not found`);
          toAgentId = target.id;
        }

        const [inserted] = await db
          .insert(messages)
          .values({
            fromAgentId: currentAgentId,
            toAgentId,
            threadId: args.threadId ?? null,
            taskId: args.taskId ?? null,
            type: args.type,
            subject: args.subject,
            content: args.content,
            deliveredAt: new Date(),
          })
          .returning();

        if (!inserted) return err('Failed to insert message');

        // Loop / chatter detection: if the same threadId has bounced too
        // many times in the last 2 minutes, refuse politely.
        if (args.threadId) {
          const exchanges = await notePairExchange({ threadId: args.threadId });
          if (exchanges > 12) {
            return err(
              `Too much back-and-forth on this thread (${exchanges} messages in 2 min). Pause, summarize what you both agree on, and either commit progress or escalate via request_approval.`,
            );
          }
        }

        // Enqueue the recipient (or every recipient on broadcast). For '*',
        // we enqueue every agent except the sender.
        if (toAgentId) {
          await enqueueDispatch(toAgentId);
        } else {
          // Broadcast: enqueue every other agent.
          const all = await db.query.agents.findMany();
          for (const a of all) {
            if (a.id === currentAgentId) continue;
            await enqueueDispatch(a.id);
          }
        }

        await eventBus.emit({
          type: 'message.sent',
          messageId: inserted.id,
          fromAgentId: currentAgentId,
          toAgentId,
          messageType: args.type,
          subject: args.subject,
          at: new Date().toISOString(),
        });

        return ok(
          `Sent ${args.type} "${args.subject}" to ${args.to} (id=${inserted.id}).`,
        );
      } catch (e) {
        logger.error({ err: e, currentAgentId }, 'send_message tool failed');
        return err(`send_message failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
}
