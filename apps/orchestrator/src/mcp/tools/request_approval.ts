import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { db } from '../../db/client.js';
import { approvals } from '../../db/schema.js';
import { eventBus } from '../../events/bus.js';
import { err, ok } from '../helpers.js';
import { logger } from '../../logger.js';

const schema = {
  title: z
    .string()
    .min(1)
    .max(500)
    .describe('One-line summary of what you need a human to approve'),
  description: z
    .string()
    .optional()
    .describe('Details the stakeholder needs to make the decision — options, trade-offs, risks'),
  taskId: z.string().uuid().optional().describe('Related task id, if any'),
};

/**
 * Ask the human stakeholder to approve/reject something before the team
 * continues. Typical uses:
 *   - Committing a breaking architectural decision
 *   - Spending real money (API call, deploy, email blast)
 *   - Publishing a preview that touches external systems
 *   - Ambiguous requirements the PM can't resolve alone
 *
 * The call is **non-blocking**: the tool returns immediately so you can
 * finish your turn. When the stakeholder decides, their answer arrives as a
 * message in your inbox (type=answer) and wakes you up automatically.
 *
 * Don't use this for routine choices — only for things a human genuinely
 * needs to weigh in on.
 */
export function requestApprovalTool(currentAgentId: string) {
  return tool(
    'request_approval',
    "Escalate a decision to the stakeholder. Non-blocking — you'll get their answer as an inbox message later.",
    schema,
    async (args) => {
      try {
        const [row] = await db
          .insert(approvals)
          .values({
            agentId: currentAgentId,
            taskId: args.taskId ?? null,
            title: args.title,
            description: args.description ?? null,
            status: 'pending',
          })
          .returning();

        if (!row) return err('failed to register approval');

        await eventBus.emit({
          type: 'approval.requested',
          approvalId: row.id,
          agentId: currentAgentId,
          taskId: args.taskId ?? null,
          title: args.title,
          at: new Date().toISOString(),
        });

        return ok(
          `Approval request "${args.title}" (id=${row.id}) sent to the stakeholder. You'll get their answer as an inbox message when they decide. Keep working on other tasks in the meantime.`,
        );
      } catch (e) {
        logger.error({ err: e, currentAgentId }, 'request_approval tool failed');
        return err(`request_approval failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
}
