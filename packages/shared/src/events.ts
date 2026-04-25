import { z } from 'zod';
import { AgentStatusSchema } from './agents';
import { TaskStatusSchema } from './tasks';

export const UIEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('agent.status'),
    agentId: z.string().uuid(),
    status: AgentStatusSchema,
    at: z.string(),
  }),
  z.object({
    type: z.literal('task.updated'),
    taskId: z.string().uuid(),
    status: TaskStatusSchema,
    assigneeId: z.string().uuid().nullable(),
    at: z.string(),
  }),
  z.object({
    type: z.literal('task.created'),
    taskId: z.string().uuid(),
    title: z.string(),
    at: z.string(),
  }),
  z.object({
    type: z.literal('message.sent'),
    messageId: z.string().uuid(),
    fromAgentId: z.string().uuid().nullable(),
    toAgentId: z.string().uuid().nullable(),
    messageType: z.string(),
    subject: z.string(),
    at: z.string(),
  }),
  z.object({
    type: z.literal('commit.created'),
    commitId: z.string().uuid(),
    agentId: z.string().uuid(),
    taskId: z.string().uuid().nullable(),
    sha: z.string(),
    branch: z.string().nullable().optional(),
    filesChanged: z.number().int().nullable().optional(),
    message: z.string(),
    at: z.string(),
  }),
  z.object({
    type: z.literal('activity'),
    agentId: z.string().uuid(),
    tool: z.string(),
    at: z.string(),
  }),
  z.object({
    // Streams the raw text an agent just produced (assistant message). Lets the
    // UI show the agent's reasoning live without waiting for a tool to fire.
    type: z.literal('agent.thinking'),
    agentId: z.string().uuid(),
    text: z.string(),
    at: z.string(),
  }),
  z.object({
    // Emitted just before a tool actually runs, so the UI can show "about to
    // invoke X" with the args. Complements the post-tool `activity` event.
    type: z.literal('agent.tool_attempt'),
    agentId: z.string().uuid(),
    tool: z.string(),
    input: z.unknown().optional(),
    at: z.string(),
  }),
  z.object({
    type: z.literal('approval.requested'),
    approvalId: z.string().uuid(),
    agentId: z.string().uuid(),
    taskId: z.string().uuid().nullable(),
    title: z.string(),
    at: z.string(),
  }),
  z.object({
    type: z.literal('approval.resolved'),
    approvalId: z.string().uuid(),
    agentId: z.string().uuid().nullable(),
    status: z.enum(['approved', 'rejected']),
    at: z.string(),
  }),
]);
export type UIEvent = z.infer<typeof UIEventSchema>;
