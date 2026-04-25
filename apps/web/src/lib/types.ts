/**
 * Re-exports + a few frontend-only aliases for clarity.
 * Never redefine shapes — source of truth is @agentboard/shared.
 */
export type {
  Agent,
  AgentRole,
  AgentStatus,
  AgentModel,
  AgentEffort,
  NewAgent,
  Task,
  TaskStatus,
  NewTask,
  Sprint,
  AgentMessage,
  MessageType,
  NewMessage,
  UIEvent,
} from '@agentboard/shared';

/**
 * Activity log row as returned by GET /api/activity.
 * The DB schema uses `event_type` + `payload` jsonb; we shape it camelCase for the UI.
 */
export interface ActivityItem {
  id: number;
  agentId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface Commit {
  id: string;
  agentId: string | null;
  taskId: string | null;
  sha: string;
  branch: string | null;
  message: string | null;
  filesChanged: number | null;
  createdAt: string;
}

export interface Preview {
  id: string;
  agentId: string | null;
  taskId: string | null;
  name: string;
  service: string | null;
  workdir: string;
  url: string;
  hostPort: number;
  internalPort: number | null;
  containerId: string | null;
  projectName: string | null;
  status: 'running' | 'stopped' | 'error';
  createdAt: string;
  stoppedAt: string | null;
}

export interface Approval {
  id: string;
  agentId: string | null;
  taskId: string | null;
  title: string;
  description: string | null;
  context: Record<string, unknown> | null;
  status: 'pending' | 'approved' | 'rejected';
  response: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface GithubStatus {
  connected: boolean;
  mode: 'gh' | 'pat' | 'oauth' | 'app' | null;
  login: string | null;
  scopes: string[] | null;
  detail?: string;
}

export interface RepoSummary {
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  defaultBranch: string;
  visibility: 'public' | 'private' | 'internal';
  pushedAt: string | null;
  htmlUrl: string;
}

export interface ProjectStats {
  tasksOpen: number;
  tasksTotal: number;
  tasksReview: number;
  runningPreviews: number;
  commits7d: number;
  lastCommitAt: string | null;
}

export interface Project {
  id: string;
  name: string;
  repoOwner: string;
  repoName: string;
  defaultBranch: string;
  clonePath: string | null;
  visibility: 'public' | 'private' | 'internal';
  description: string | null;
  createdAt: string;
  stats?: ProjectStats | null;
}

export interface ProjectDetail extends Project {
  tasks: import('./types').Task[];
}

export interface PullRequestSummary {
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  author: string;
  baseRefName: string;
  headRefName: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  labels: string[];
  checks: 'SUCCESS' | 'FAILURE' | 'PENDING' | 'UNKNOWN';
  reviewDecision: 'APPROVED' | 'REVIEW_REQUIRED' | 'CHANGES_REQUESTED' | null;
  additions: number;
  deletions: number;
  changedFiles: number;
}

export interface IssueSummary {
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED';
  author: string;
  labels: string[];
  assignees: string[];
  createdAt: string;
  updatedAt: string;
  url: string;
  body: string;
  comments: number;
}

export interface UsageSummary {
  mode: 'subscription' | 'api';
  totals: {
    turns: number;
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    totalTokens: number;
    costMicroUsd: number;
  };
  today: { turns: number; totalTokens: number; costMicroUsd: number };
  week: { turns: number; totalTokens: number; costMicroUsd: number };
  byAgent: Array<{
    agentId: string;
    agentName: string;
    turns: number;
    totalTokens: number;
    todayTokens: number;
    costMicroUsd: number;
  }>;
  byModel: Array<{
    model: string;
    turns: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costMicroUsd: number;
  }>;
  byDay: Array<{ day: string; tokens: number; costMicroUsd: number }>;
}

export interface ReplayEvent {
  kind: 'message' | 'activity' | 'commit';
  at: string;
  agentId: string | null;
  payload: Record<string, unknown>;
}

export interface BranchSummary {
  name: string;
  commitSha: string;
  commitMessage: string;
  commitAuthor: string;
  commitDate: string;
  isProtected: boolean;
  aheadOfDefault: number;
  behindDefault: number;
}

/**
 * Local alias — shorter name used throughout components.
 */
export type { AgentMessage as Message } from '@agentboard/shared';
