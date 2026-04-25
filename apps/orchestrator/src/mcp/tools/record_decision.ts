import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { db } from '../../db/client.js';
import { decisions } from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { err, ok } from '../helpers.js';
import { logger } from '../../logger.js';

const schema = {
  title: z.string().min(1).max(300).describe('One-line headline of the decision'),
  body: z
    .string()
    .min(1)
    .max(20_000)
    .describe(
      'Markdown explaining the decision, the alternatives considered, and the reasoning. Will be searchable by future agents.',
    ),
  taskId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
};

/**
 * Persist an architectural decision so future agents (and humans) can find
 * it later. Use this whenever the team makes a non-obvious call: stack
 * choice, tradeoff, naming convention, deprecation, etc. The persona builder
 * surfaces recent decisions to every new turn so nobody re-debates closed
 * topics.
 */
export function recordDecisionTool(currentAgentId: string) {
  return tool(
    'record_decision',
    'Record a decision (an ADR) so the team remembers it. Use this for stack choices, conventions, and tradeoffs — anything you wouldn\'t want to re-debate.',
    schema,
    async (args) => {
      try {
        const [row] = await db
          .insert(decisions)
          .values({
            agentId: currentAgentId,
            taskId: args.taskId ?? null,
            projectId: args.projectId ?? null,
            title: args.title,
            body: args.body,
          })
          .returning();
        if (!row) return err('failed to insert decision');
        await audit({
          kind: 'decision.recorded',
          actor: currentAgentId,
          payload: { decisionId: row.id, title: args.title, taskId: args.taskId ?? null },
        });
        return ok(`Recorded decision ${row.id.slice(0, 8)}: "${args.title}".`);
      } catch (e) {
        logger.error({ err: e, currentAgentId }, 'record_decision tool failed');
        return err(`record_decision failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
}
