import { z } from 'zod';

export const TaskStatusSchema = z.enum([
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskSchema = z.object({
  id: z.string().uuid(),
  sprintId: z.string().uuid().nullable(),
  projectId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(500),
  description: z.string().nullable(),
  status: TaskStatusSchema,
  assigneeId: z.string().uuid().nullable(),
  createdBy: z.string().uuid().nullable(),
  priority: z.number().int().min(1).max(5),
  parentId: z.string().uuid().nullable(),
  branch: z.string().nullable().optional(),
  prUrl: z.string().nullable().optional(),
  prNumber: z.number().int().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Task = z.infer<typeof TaskSchema>;

export const NewTaskSchema = TaskSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial({
  sprintId: true,
  description: true,
  status: true,
  assigneeId: true,
  createdBy: true,
  priority: true,
  parentId: true,
});
export type NewTask = z.infer<typeof NewTaskSchema>;

export const SprintSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  goal: z.string().nullable(),
  status: z.enum(['planning', 'active', 'closed']),
  startedAt: z.string().nullable(),
  endsAt: z.string().nullable(),
});
export type Sprint = z.infer<typeof SprintSchema>;
