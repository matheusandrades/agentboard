import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { db } from '../../db/client.js';
import { agents, projects, tasks } from '../../db/schema.js';
import { openPullRequest } from '../../github/client.js';
import { eventBus } from '../../events/bus.js';
import { err, ok } from '../helpers.js';
import { logger } from '../../logger.js';

const schema = {
  taskId: z
    .string()
    .uuid()
    .describe('Task id whose branch should be turned into a PR. The task must belong to a project.'),
  title: z.string().min(1).max(500).describe('PR title'),
  body: z
    .string()
    .max(20_000)
    .optional()
    .describe('PR body (markdown). Summarize what changed and link the task id.'),
};

/**
 * Push the agent's task branch to origin and open a GitHub pull request
 * against the project's default branch. Saves the PR URL + number on the
 * task row so the UI can link to it.
 */
export function openPrTool(currentAgentId: string) {
  return tool(
    'open_pr',
    `Push the current task branch and open a GitHub Pull Request. Only works for tasks attached to a connected project. Returns the PR URL.`,
    schema,
    async (args) => {
      try {
        const [agent] = await db
          .select()
          .from(agents)
          .where(eq(agents.id, currentAgentId))
          .limit(1);
        if (!agent) return err('agent not found');

        const [task] = await db.select().from(tasks).where(eq(tasks.id, args.taskId)).limit(1);
        if (!task) return err('task not found');
        if (!task.projectId) {
          return err(
            "this task isn't attached to a project; connect a repo in /projects and assign it to the task first",
          );
        }
        if (!task.branch) {
          return err(
            "this task doesn't have a working branch yet — make at least one commit via the task first",
          );
        }

        const [project] = await db
          .select()
          .from(projects)
          .where(eq(projects.id, task.projectId))
          .limit(1);
        if (!project || !project.clonePath) return err('project not cloned locally');

        const body =
          args.body ??
          [
            `Automated PR from **${agent.name}** for task **${task.title}**.`,
            '',
            `- Task ID: ${task.id}`,
            `- Branch: \`${task.branch}\``,
            '',
            '_Review by opening the files tab or checking out the branch locally._',
          ].join('\n');

        const { number, url } = await openPullRequest({
          cwd: project.clonePath,
          title: args.title,
          body,
          baseBranch: project.defaultBranch,
          headBranch: task.branch,
        });

        await db
          .update(tasks)
          .set({ prNumber: number, prUrl: url, updatedAt: new Date() })
          .where(eq(tasks.id, task.id));

        await eventBus.emit({
          type: 'task.updated',
          taskId: task.id,
          status: task.status as never,
          assigneeId: task.assigneeId,
          at: new Date().toISOString(),
        });

        return ok(
          `Pull request #${number} opened: ${url}. The PR targets \`${project.defaultBranch}\` from \`${task.branch}\`.`,
        );
      } catch (e) {
        logger.error({ err: e, currentAgentId }, 'open_pr tool failed');
        return err(`open_pr failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
}
