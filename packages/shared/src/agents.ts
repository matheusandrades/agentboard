import { z } from 'zod';

export const AgentRoleSchema = z.enum([
  'pm',
  'cto',
  'ui-ux',
  'lang-specialist',
  'frontend',
  'backend',
  'dba',
  'qa',
]);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const AgentStatusSchema = z.enum([
  'idle',
  'working',
  'blocked',
  'error',
]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const AgentModelSchema = z.enum([
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
]);
export type AgentModel = z.infer<typeof AgentModelSchema>;

/**
 * Mirrors the SDK's `options.effort` enum. "off" = disable extended thinking
 * (mapped to `undefined` on the wire). The SDK accepts 'low' | 'medium' |
 * 'high' | 'xhigh' | 'max' for models that support effort levels.
 */
export const AgentEffortSchema = z.enum(['off', 'low', 'medium', 'high', 'xhigh', 'max']);
export type AgentEffort = z.infer<typeof AgentEffortSchema>;

export const AgentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  role: AgentRoleSchema,
  personaPath: z.string(),
  sessionId: z.string().nullable(),
  status: AgentStatusSchema,
  worktreePath: z.string().nullable(),
  model: AgentModelSchema.nullable().optional(),
  maxTurns: z.number().int().min(1).max(200).nullable().optional(),
  extendedThinking: AgentEffortSchema.nullable().optional(),
  rules: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type Agent = z.infer<typeof AgentSchema>;

/**
 * Factory defaults. Every agent starts on Opus 4.7 at max effort — operator
 * can downgrade individually from the UI. Values here are the last-resort
 * fallback when an agent row has all three tuning columns NULL.
 */
export const DEFAULT_MODEL: AgentModel = 'claude-opus-4-7';
export const DEFAULT_EFFORT: AgentEffort = 'max';
export const DEFAULT_MAX_TURNS = 50;

export const NewAgentSchema = AgentSchema.pick({
  name: true,
  role: true,
  personaPath: true,
});
export type NewAgent = z.infer<typeof NewAgentSchema>;

export const AGENT_ROLES: Readonly<Record<AgentRole, { defaultName: string; title: string }>> = {
  pm: { defaultName: 'alice-pm', title: 'Project Manager' },
  cto: { defaultName: 'carl-cto', title: 'CTO' },
  'ui-ux': { defaultName: 'uma-uiux', title: 'UI/UX Designer' },
  'lang-specialist': { defaultName: 'leo-langs', title: 'Language Specialist' },
  frontend: { defaultName: 'lucas-frontend', title: 'Frontend Engineer' },
  backend: { defaultName: 'bruno-backend', title: 'Backend Engineer' },
  dba: { defaultName: 'dani-dba', title: 'Database Administrator' },
  qa: { defaultName: 'quin-qa', title: 'QA Engineer' },
};
