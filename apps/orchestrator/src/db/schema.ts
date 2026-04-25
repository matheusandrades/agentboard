import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  jsonb,
  bigserial,
  boolean,
  index,
} from 'drizzle-orm/pg-core';

/* ------------------------------ users -------------------------------
 * Operators of the platform — the humans who log in. NOT the AI agents.
 * Only `admin` can manage users, settings, and destructive operations.
 * `member` can run the team (chat, create tasks, edit personas + rules,
 * approve, etc). Add `viewer` later if a read-only role is needed.
 */
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  username: varchar('username', { length: 100 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: varchar('role', { length: 20 }).notNull().default('member'),
  isDisabled: boolean('is_disabled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
});
export type UserRow = InferSelectModel<typeof users>;
export type NewUserRow = InferInsertModel<typeof users>;

/* ----------------------------- sessions -----------------------------
 * Server-side session store. The cookie carries the session id; this
 * table holds the truth, so revoking is just a row delete.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(), // random 32-byte token, base64url
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    userAgent: text('user_agent'),
    ipAddress: varchar('ip_address', { length: 64 }),
  },
  (t) => ({ byUser: index('sessions_user_id_idx').on(t.userId) }),
);
export type SessionRow = InferSelectModel<typeof sessions>;

/* ------------------------------ agents ------------------------------ */
export const agents = pgTable('agents', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  role: varchar('role', { length: 50 }).notNull(),
  personaPath: text('persona_path').notNull(),
  sessionId: text('session_id'),
  status: varchar('status', { length: 20 }).default('idle').notNull(),
  worktreePath: text('worktree_path'),
  // Per-agent SDK tuning. All nullable so seed rows stay minimal and the
  // runner falls back to repo-wide defaults from env when these are NULL.
  model: varchar('model', { length: 60 }),
  maxTurns: integer('max_turns'),
  extendedThinking: varchar('extended_thinking', { length: 20 }),
  // Cost guardrails. NULL = inherit org default. Stored in micro-USD
  // (10⁶ × $) so we don't have to round-trip floats.
  dailyCostCapMicroUsd: integer('daily_cost_cap_micro_usd'),
  totalCostCapMicroUsd: integer('total_cost_cap_micro_usd'),
  // Operating rules — appended after the persona in the system prompt. Editable
  // from the UI, seeded with a per-role template on first boot. NULL means
  // "use the bundled template for this role"; empty string means "no rules".
  rules: text('rules'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/* ------------------------------ sprints ----------------------------- */
export const sprints = pgTable('sprints', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  goal: text('goal'),
  status: varchar('status', { length: 20 }).default('active').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
});

/* ------------------------------ tasks ------------------------------- */
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sprintId: uuid('sprint_id').references(() => sprints.id),
    projectId: uuid('project_id'), // reference added below to avoid circular decl
    title: varchar('title', { length: 500 }).notNull(),
    description: text('description'),
    status: varchar('status', { length: 20 }).default('backlog').notNull(),
    assigneeId: uuid('assignee_id').references(() => agents.id),
    createdBy: uuid('created_by').references(() => agents.id),
    priority: integer('priority').default(3).notNull(),
    parentId: uuid('parent_id'),
    branch: varchar('branch', { length: 200 }),
    prUrl: text('pr_url'),
    prNumber: integer('pr_number'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    statusSprintIdx: index('idx_tasks_status').on(t.status, t.sprintId),
  }),
);

/* ----------------------------- messages ----------------------------- */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    fromAgentId: uuid('from_agent_id').references(() => agents.id),
    toAgentId: uuid('to_agent_id').references(() => agents.id),
    threadId: uuid('thread_id'),
    taskId: uuid('task_id').references(() => tasks.id),
    type: varchar('type', { length: 30 }).notNull(),
    subject: varchar('subject', { length: 500 }),
    content: text('content').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown> | null>(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    toUnreadIdx: index('idx_messages_to_unread').on(t.toAgentId, t.readAt),
  }),
);

/* ----------------------------- commits ------------------------------ */
export const commits = pgTable('commits', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').references(() => agents.id),
  taskId: uuid('task_id').references(() => tasks.id),
  sha: varchar('sha', { length: 40 }).notNull(),
  branch: varchar('branch', { length: 200 }),
  message: text('message'),
  filesChanged: integer('files_changed'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/* ----------------------------- previews ------------------------------ */
export const previews = pgTable('previews', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').references(() => agents.id),
  taskId: uuid('task_id').references(() => tasks.id),
  name: varchar('name', { length: 200 }).notNull(),
  service: varchar('service', { length: 100 }), // compose service, or null for Dockerfile-only
  workdir: text('workdir').notNull(),
  url: text('url').notNull(),
  hostPort: integer('host_port').notNull(),
  internalPort: integer('internal_port'),
  containerId: varchar('container_id', { length: 128 }),
  projectName: varchar('project_name', { length: 100 }),
  status: varchar('status', { length: 20 }).default('running').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  stoppedAt: timestamp('stopped_at', { withTimezone: true }),
});

/* --------------------------- usage_events --------------------------- */
/**
 * Per-turn token + cost record. Captured from the SDK `result` message and
 * priced via the static table in lib/pricing.ts. Drives the /spend page
 * and the budget guard that blocks runaway loops before they get expensive.
 */
export const usageEvents = pgTable(
  'usage_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    agentId: uuid('agent_id').references(() => agents.id),
    taskId: uuid('task_id').references(() => tasks.id),
    sessionId: text('session_id'),
    model: varchar('model', { length: 60 }).notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    // Stored in micro-USD (10⁶ × dollars) so an int suffices.
    costMicroUsd: integer('cost_micro_usd').notNull().default(0),
    durationMs: integer('duration_ms'),
    succeeded: boolean('succeeded').notNull().default(true),
    timedOut: boolean('timed_out').notNull().default(false),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byAgentRecent: index('idx_usage_agent_recent').on(t.agentId, t.endedAt),
    byEnded: index('idx_usage_ended').on(t.endedAt),
  }),
);

/* --------------------------- decisions ------------------------------ */
/**
 * Architectural Decision Records produced by agents. The `record_decision`
 * MCP tool inserts here; the persona builder reads recent rows to give
 * agents memory across sessions ("we already chose Postgres last sprint").
 */
export const decisions = pgTable('decisions', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id'),
  agentId: uuid('agent_id').references(() => agents.id),
  taskId: uuid('task_id').references(() => tasks.id),
  title: varchar('title', { length: 300 }).notNull(),
  body: text('body').notNull(),
  context: jsonb('context').$type<Record<string, unknown> | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/* --------------------------- audit_events --------------------------- */
/**
 * Append-only, hash-chained audit log. `prev_hash` of row N must equal
 * `hash` of row N-1 — any in-place mutation is detectable. Designed for
 * compliance exports.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    kind: varchar('kind', { length: 60 }).notNull(),
    actor: varchar('actor', { length: 200 }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    prevHash: varchar('prev_hash', { length: 64 }),
    hash: varchar('hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byKind: index('idx_audit_kind').on(t.kind, t.createdAt),
  }),
);

/* --------------------------- notifications -------------------------- */
/**
 * Outbound webhook configurations. Each row fires a JSON POST to `targetUrl`
 * for the listed event kinds. Slack/Discord/Teams accept the simple payload
 * shape without modification; for email use a service like Resend.
 */
export const notifications = pgTable('notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  label: varchar('label', { length: 200 }).notNull(),
  targetUrl: text('target_url').notNull(),
  kinds: jsonb('kinds').$type<string[]>().notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  template: varchar('template', { length: 30 }).default('slack').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/* --------------------- GitHub connections / projects ---------------- */

/**
 * Stores the GitHub identity the orchestrator will use to clone repos,
 * push branches, and open PRs. We support two auth modes:
 *   - `gh`    → shell out to the locally-installed `gh` CLI (default when
 *               available; picks up SSO, fine-grained PATs, GitHub Apps)
 *   - `pat`   → fall back to a Personal Access Token stored here
 *
 * On a fresh install there's no row. The `/api/github/status` endpoint
 * detects `gh auth status` and auto-creates a 'gh' row with the resolved
 * login so the UI can show "connected as X".
 */
/* --------------------------- app_settings ---------------------------
 * Tiny key/value store for "platform settings the operator edits in the
 * UI" — OAuth client id+secret, webhook URL hint, default branch policy,
 * etc. Each key maps to a free-form JSON blob. Reads are admin-only
 * because some values (OAuth secret, webhook secret) are sensitive.
 */
export const appSettings = pgTable('app_settings', {
  key: varchar('key', { length: 100 }).primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  updatedBy: uuid('updated_by'),
});
export type AppSettingRow = InferSelectModel<typeof appSettings>;

export const githubConnections = pgTable('github_connections', {
  id: uuid('id').defaultRandom().primaryKey(),
  // 'gh' | 'pat' | 'oauth' | 'app' — only one row should ever live in
  // this table; new connect calls upsert it.
  mode: varchar('mode', { length: 20 }).notNull(),
  login: varchar('login', { length: 200 }).notNull(),
  accessToken: text('access_token'), // null when mode='gh'
  refreshToken: text('refresh_token'), // OAuth refresh, when issued
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  scopes: text('scopes'),
  // For mode='app': the GitHub App installation id (used to mint
  // installation tokens via JWT). Null for other modes.
  installationId: integer('installation_id'),
  connectedAt: timestamp('connected_at', { withTimezone: true }).defaultNow().notNull(),
});

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  repoOwner: varchar('repo_owner', { length: 100 }).notNull(),
  repoName: varchar('repo_name', { length: 100 }).notNull(),
  defaultBranch: varchar('default_branch', { length: 120 }).default('main').notNull(),
  clonePath: text('clone_path'),
  visibility: varchar('visibility', { length: 20 }).default('private').notNull(), // 'public' | 'private'
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/* ---------------------------- approvals ------------------------------ */
export const approvals = pgTable('approvals', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').references(() => agents.id),
  taskId: uuid('task_id').references(() => tasks.id),
  title: varchar('title', { length: 500 }).notNull(),
  description: text('description'),
  context: jsonb('context').$type<Record<string, unknown> | null>(),
  status: varchar('status', { length: 20 }).default('pending').notNull(),
  response: text('response'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});

/* --------------------------- activity_log --------------------------- */
export const activityLog = pgTable(
  'activity_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    agentId: uuid('agent_id').references(() => agents.id),
    eventType: varchar('event_type', { length: 50 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    recentIdx: index('idx_activity_recent').on(t.createdAt),
  }),
);

/* ------------------------------ Types ------------------------------- */
export type AgentRow = InferSelectModel<typeof agents>;
export type NewAgentRow = InferInsertModel<typeof agents>;

export type SprintRow = InferSelectModel<typeof sprints>;
export type NewSprintRow = InferInsertModel<typeof sprints>;

export type TaskRow = InferSelectModel<typeof tasks>;
export type NewTaskRow = InferInsertModel<typeof tasks>;

export type MessageRow = InferSelectModel<typeof messages>;
export type NewMessageRow = InferInsertModel<typeof messages>;

export type CommitRow = InferSelectModel<typeof commits>;
export type NewCommitRow = InferInsertModel<typeof commits>;

export type ActivityRow = InferSelectModel<typeof activityLog>;
export type NewActivityRow = InferInsertModel<typeof activityLog>;

export type PreviewRow = InferSelectModel<typeof previews>;
export type NewPreviewRow = InferInsertModel<typeof previews>;

export type ApprovalRow = InferSelectModel<typeof approvals>;
export type NewApprovalRow = InferInsertModel<typeof approvals>;

export type ProjectRow = InferSelectModel<typeof projects>;
export type NewProjectRow = InferInsertModel<typeof projects>;

export type GithubConnectionRow = InferSelectModel<typeof githubConnections>;
export type NewGithubConnectionRow = InferInsertModel<typeof githubConnections>;

export type UsageEventRow = InferSelectModel<typeof usageEvents>;
export type NewUsageEventRow = InferInsertModel<typeof usageEvents>;

export type DecisionRow = InferSelectModel<typeof decisions>;
export type NewDecisionRow = InferInsertModel<typeof decisions>;

export type AuditEventRow = InferSelectModel<typeof auditEvents>;
export type NewAuditEventRow = InferInsertModel<typeof auditEvents>;

export type NotificationRow = InferSelectModel<typeof notifications>;
export type NewNotificationRow = InferInsertModel<typeof notifications>;

/* --------------- Convenience map used by the migrator --------------- */
export const schema = {
  agents,
  sprints,
  tasks,
  messages,
  commits,
  activityLog,
  previews,
  approvals,
  projects,
  githubConnections,
  usageEvents,
  decisions,
  auditEvents,
  notifications,
};
