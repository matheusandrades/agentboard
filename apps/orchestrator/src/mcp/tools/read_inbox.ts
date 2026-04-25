import { z } from 'zod';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { db } from '../../db/client.js';
import { messages } from '../../db/schema.js';
import { err, ok } from '../helpers.js';
import { logger } from '../../logger.js';

const schema = {
  limit: z.number().int().min(1).max(50).optional().describe('Max messages to return (default 20)'),
  onlyUnread: z.boolean().optional().describe('If true, return only unread messages'),
};

export function readInboxTool(currentAgentId: string) {
  return tool(
    'read_inbox',
    "Re-read recent messages addressed to this agent. Useful when you need to remind yourself of context or catch up on anything you might have skimmed.",
    schema,
    async (args) => {
      try {
        const limit = args.limit ?? 20;
        const where = args.onlyUnread
          ? and(eq(messages.toAgentId, currentAgentId), isNull(messages.readAt))
          : eq(messages.toAgentId, currentAgentId);

        const rows = await db
          .select()
          .from(messages)
          .where(where)
          .orderBy(desc(messages.createdAt))
          .limit(limit);

        const summary = rows.map((m) => ({
          id: m.id,
          from: m.fromAgentId,
          type: m.type,
          subject: m.subject,
          content: m.content,
          taskId: m.taskId,
          threadId: m.threadId,
          createdAt: m.createdAt,
          readAt: m.readAt,
        }));

        return ok(JSON.stringify(summary, null, 2));
      } catch (e) {
        logger.error({ err: e, currentAgentId }, 'read_inbox tool failed');
        return err(`read_inbox failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
}
