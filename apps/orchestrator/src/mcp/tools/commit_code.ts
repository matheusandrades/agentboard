import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { db } from '../../db/client.js';
import { commits } from '../../db/schema.js';
import { eventBus } from '../../events/bus.js';
import { err, getAgentById, ok } from '../helpers.js';
import { commitInWorktree } from '../../worktree/manager.js';
import { logger } from '../../logger.js';

const schema = {
  message: z.string().min(1).describe('Commit message (conventional commits style recommended)'),
  taskId: z.string().uuid().optional().describe('The task this commit resolves / advances'),
};

export function commitCodeTool(currentAgentId: string) {
  return tool(
    'commit_code',
    "Stage all changes in this agent's worktree and create a git commit. Returns the commit SHA.",
    schema,
    async (args) => {
      try {
        const agent = await getAgentById(currentAgentId);
        if (!agent) return err('Current agent not found');
        if (!agent.worktreePath) return err('Agent has no worktree — cannot commit');

        const result = await commitInWorktree(agent.worktreePath, args.message);
        if (!result) return ok('Nothing to commit (working tree clean).');

        const [row] = await db
          .insert(commits)
          .values({
            agentId: currentAgentId,
            taskId: args.taskId ?? null,
            sha: result.sha,
            branch: result.branch,
            message: args.message,
            filesChanged: result.filesChanged,
          })
          .returning();

        if (row) {
          await eventBus.emit({
            type: 'commit.created',
            commitId: row.id,
            agentId: currentAgentId,
            taskId: args.taskId ?? null,
            sha: result.sha,
            branch: result.branch,
            filesChanged: result.filesChanged,
            message: args.message,
            at: new Date().toISOString(),
          });
        }

        return ok(
          `Committed ${result.sha.slice(0, 7)} (${result.filesChanged} files)${row ? `, stored as ${row.id}` : ''}.`,
        );
      } catch (e) {
        logger.error({ err: e, currentAgentId }, 'commit_code tool failed');
        return err(`commit_code failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
}
