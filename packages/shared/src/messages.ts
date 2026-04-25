import { z } from 'zod';

export const MessageTypeSchema = z.enum([
  'assignment',
  'question',
  'answer',
  'handoff',
  'status',
  'review',
  'broadcast',
]);
export type MessageType = z.infer<typeof MessageTypeSchema>;

export const AgentMessageSchema = z.object({
  id: z.string().uuid(),
  from: z.string().min(1),
  to: z.union([z.string().min(1), z.literal('*')]),
  threadId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  type: MessageTypeSchema,
  subject: z.string().min(1).max(500),
  content: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string(),
});
export type AgentMessage = z.infer<typeof AgentMessageSchema>;

export const NewMessageSchema = AgentMessageSchema.omit({
  id: true,
  createdAt: true,
});
export type NewMessage = z.infer<typeof NewMessageSchema>;
