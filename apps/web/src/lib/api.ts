import { API_URL } from './env';
import type {
  Agent,
  AgentRole,
  AgentModel,
  AgentEffort,
  Task,
  NewTask,
  TaskStatus,
  Sprint,
  AgentMessage,
  NewMessage,
  ActivityItem,
  Commit,
  Preview,
  Approval,
  GithubStatus,
  RepoSummary,
  Project,
  ProjectDetail,
  PullRequestSummary,
  IssueSummary,
  BranchSummary,
  UsageSummary,
  ReplayEvent,
} from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body: unknown,
  ) {
    super(`API ${status} ${statusText}`);
    this.name = 'ApiError';
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

function buildUrl(path: string, query?: Query): string {
  const url = new URL(path.replace(/^\//, ''), API_URL.endsWith('/') ? API_URL : API_URL + '/');
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; query?: Query; accept?: 'json' | 'text' } = {},
): Promise<T> {
  const { body, query, accept = 'json' } = options;
  const res = await fetch(buildUrl(path, query), {
    method,
    // Send the auth session cookie cross-origin (orchestrator on :3001 vs web on :5173).
    credentials: 'include',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();

  if (!res.ok) {
    let parsed: unknown = text;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        /* keep text */
      }
    }
    throw new ApiError(res.status, res.statusText, parsed);
  }

  if (accept === 'text') return text as unknown as T;

  if (!text) return undefined as unknown as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

// ---------- Agents ----------
export const listAgents = () => request<Agent[]>('GET', '/api/agents');
export const getAgent = (id: string) => request<Agent>('GET', `/api/agents/${id}`);
export const createAgent = (body: { name: string; role: AgentRole; persona?: string }) =>
  request<Agent>('POST', '/api/agents', { body });
export const updateAgent = (
  id: string,
  body: {
    name?: string;
    role?: AgentRole;
    model?: AgentModel | null;
    maxTurns?: number | null;
    extendedThinking?: AgentEffort | null;
  },
) => request<Agent>('PATCH', `/api/agents/${id}`, { body });
export const deleteAgent = (id: string) => request<void>('DELETE', `/api/agents/${id}`);

// ---------- Persona ----------
export const getPersona = (id: string) =>
  request<string>('GET', `/api/agents/${id}/persona`, { accept: 'text' });
export const updatePersona = (id: string, content: string) =>
  request<Agent>('PUT', `/api/agents/${id}/persona`, { body: { content } });
export const getPersonaTemplate = (role: AgentRole) =>
  request<string>('GET', `/api/personas/templates/${role}`, { accept: 'text' });

// ---------- Rules ----------
export const getRules = (id: string) =>
  request<string>('GET', `/api/agents/${id}/rules`, { accept: 'text' });
export const updateRules = (id: string, content: string) =>
  request<Agent>('PUT', `/api/agents/${id}/rules`, { body: { content } });
export const resetRules = (id: string) =>
  request<Agent>('DELETE', `/api/agents/${id}/rules`);
export const getRulesTemplate = (role: AgentRole) =>
  request<string>('GET', `/api/rules/templates/${role}`, { accept: 'text' });

// ---------- Tasks ----------
export const listTasks = (sprintId?: string) =>
  request<Task[]>('GET', '/api/tasks', { query: { sprint: sprintId } });
export const createTask = (body: NewTask) => request<Task>('POST', '/api/tasks', { body });
export const updateTask = (id: string, body: Partial<Task> & { status?: TaskStatus }) =>
  request<Task>('PATCH', `/api/tasks/${id}`, { body });

// ---------- Sprints ----------
export const listSprints = () => request<Sprint[]>('GET', '/api/sprints');
export const createSprint = (body: {
  name: string;
  goal?: string | null;
  startedAt?: string | null;
  endsAt?: string | null;
}) => request<Sprint>('POST', '/api/sprints', { body });

// ---------- Messages ----------
export const sendMessage = (body: NewMessage) =>
  request<AgentMessage>('POST', '/api/messages', { body });
export const listMessages = (agentId?: string) =>
  request<AgentMessage[]>('GET', '/api/messages', { query: { agent: agentId } });

// ---------- Activity / Commits ----------
export const listActivity = (limit = 200) =>
  request<ActivityItem[]>('GET', '/api/activity', { query: { limit } });
export const listCommits = (agentId?: string) =>
  request<Commit[]>('GET', '/api/commits', { query: { agent: agentId } });
export const getCommit = (id: string) =>
  request<Commit & { diff: string; stats: string }>('GET', `/api/commits/${id}`);

// ---------- Previews ----------
export const listPreviews = () => request<Preview[]>('GET', '/api/previews');
export const stopPreview = (id: string) => request<void>('DELETE', `/api/previews/${id}`);
export const startPreview = (id: string) =>
  request<Preview>('POST', `/api/previews/${id}/start`);

// ---------- Approvals ----------
export const listApprovals = (status?: 'pending' | 'approved' | 'rejected') =>
  request<Approval[]>('GET', '/api/approvals', { query: { status } });
export const resolveApproval = (id: string, body: { approved: boolean; note?: string }) =>
  request<Approval>('POST', `/api/approvals/${id}/resolve`, { body });

// ---------- GitHub ----------
export const githubStatus = () => request<GithubStatus>('GET', '/api/github/status');
export const githubConnect = (token: string) =>
  request<GithubStatus>('POST', '/api/github/connect', { body: { token } });
export const githubDisconnect = () => request<void>('DELETE', '/api/github/connect');
export const githubRepos = (opts: { limit?: number; owner?: string } = {}) =>
  request<RepoSummary[]>('GET', '/api/github/repos', {
    query: { limit: opts.limit ?? 100, owner: opts.owner },
  });

export interface GithubAccount {
  login: string;
  name: string | null;
  description: string | null;
  avatarUrl: string;
  htmlUrl: string;
  isUser?: boolean;
}
export const githubAccounts = () => request<GithubAccount[]>('GET', '/api/github/accounts');

// OAuth App flow. `oauthConfig` tells the UI whether the operator
// configured the env vars; `oauthStart` returns the URL the browser
// should hop to (we open it in a popup so the user keeps their place).
export interface GithubOauthConfig {
  enabled: boolean;
  source: 'db' | 'env' | null;
  clientIdMasked: string | null;
  defaultRedirectUrl: string;
}
export const githubOauthConfig = () =>
  request<GithubOauthConfig>('GET', '/api/github/oauth/config');
export const githubOauthStart = () =>
  request<{ url: string }>('GET', '/api/github/oauth/start');
export const githubOauthDisconnect = () =>
  request<void>('DELETE', '/api/github/oauth');
export const saveGithubOauthCreds = (body: {
  clientId: string;
  clientSecret: string;
  redirectUrl?: string;
}) => request<{ ok: true }>('PUT', '/api/github/oauth/config', { body });
export const clearGithubOauthCreds = () =>
  request<{ ok: true }>('DELETE', '/api/github/oauth/config');

// GitHub App manifest + install flow
export interface GithubAppConfig {
  configured: boolean;
  slug: string | null;
  htmlUrl: string | null;
  installUrl: string | null;
  manifestEndpoint: string | null;
  baseUrl: string;
  webBaseUrl: string;
}
export const githubAppConfig = () =>
  request<GithubAppConfig>('GET', '/api/github/app/config');
export const githubAppPrepareManifest = (body: {
  name: string;
  description?: string;
  organization?: string;
  webhookPublicUrl?: string;
}) =>
  request<{ manifest: string; action: string; state: string }>(
    'POST',
    '/api/github/app/manifest',
    { body },
  );
export const githubAppDisconnectInstallation = () =>
  request<{ ok: true }>('DELETE', '/api/github/app');
export const githubAppForget = () =>
  request<{ ok: true }>('DELETE', '/api/github/app/config');

// ---------- Projects ----------
export const listProjects = () => request<Project[]>('GET', '/api/projects');
export const getProject = (id: string) => request<ProjectDetail>('GET', `/api/projects/${id}`);
export const createProject = (body: {
  owner: string;
  repo: string;
  name?: string;
  defaultBranch?: string;
  description?: string;
  visibility?: 'public' | 'private' | 'internal';
}) => request<Project>('POST', '/api/projects', { body });
export const deleteProject = (id: string) => request<void>('DELETE', `/api/projects/${id}`);
export const projectPulls = (id: string, state: 'open' | 'closed' | 'all' = 'all') =>
  request<PullRequestSummary[]>('GET', `/api/projects/${id}/pulls`, { query: { state } });
export const projectIssues = (id: string, state: 'open' | 'closed' | 'all' = 'open') =>
  request<IssueSummary[]>('GET', `/api/projects/${id}/issues`, { query: { state } });
export const projectBranches = (id: string) =>
  request<BranchSummary[]>('GET', `/api/projects/${id}/branches`);
export const importIssue = (id: string, number: number, assigneeId?: string | null) =>
  request<{ id: string }>('POST', `/api/projects/${id}/issues/${number}/import`, {
    body: { assigneeId },
  });

// ---------- Mentions ----------
export interface MentionCandidate {
  type: 'agent' | 'task' | 'commit';
  token: string;
  label: string;
  subtitle?: string;
  refId?: string;
}
export const searchMentions = (query: string, opts: { types?: string; projectId?: string } = {}) =>
  request<MentionCandidate[]>('GET', '/api/mentions/search', {
    query: { q: query, types: opts.types, projectId: opts.projectId },
  });

// ---------- Files ----------
export interface TreeEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  ignored?: boolean;
}
export interface TreeResponse {
  path: string;
  truncated: boolean;
  entries: TreeEntry[];
}
export interface FileResponse {
  path: string;
  size: number;
  encoding: 'utf8' | 'binary' | 'too-large';
  language: string;
  content?: string;
  truncated: boolean;
}
export const projectTree = (id: string, dirPath = '') =>
  request<TreeResponse>('GET', `/api/projects/${id}/tree`, { query: { path: dirPath } });
export const projectFile = (id: string, filePath: string) =>
  request<FileResponse>('GET', `/api/projects/${id}/file`, { query: { path: filePath } });
export interface FileSearchHit {
  path: string;
  name: string;
  size: number;
  score: number;
}
export const projectSearchFiles = (id: string, query: string, limit = 30) =>
  request<{ query: string; results: FileSearchHit[] }>(
    'GET',
    `/api/projects/${id}/files/search`,
    { query: { q: query, limit } },
  );

// ---------- Notifications ----------
export interface NotificationConfig {
  id: string;
  label: string;
  targetUrl: string;
  kinds: string[];
  enabled: boolean;
  template: 'slack' | 'generic';
  createdAt: string;
}
export const listNotifications = () =>
  request<NotificationConfig[]>('GET', '/api/notifications');
export const createNotification = (body: {
  label: string;
  targetUrl: string;
  kinds?: string[];
  enabled?: boolean;
  template?: 'slack' | 'generic';
}) => request<NotificationConfig>('POST', '/api/notifications', { body });
export const deleteNotification = (id: string) =>
  request<void>('DELETE', `/api/notifications/${id}`);
export const testNotification = (id: string) =>
  request<{ ok: boolean; status?: number }>('POST', `/api/notifications/${id}/test`);

// ---------- Usage / budget ----------
export const usage = () => request<UsageSummary>('GET', '/api/usage');
export const updateAgentBudget = (
  id: string,
  body: { dailyCostCapMicroUsd?: number | null; totalCostCapMicroUsd?: number | null },
) => request('PATCH', `/api/agents/${id}/budget`, { body });

// ---------- Replay ----------
export const taskReplay = (id: string) =>
  request<{ task: Task; events: ReplayEvent[] }>('GET', `/api/tasks/${id}/replay`);

// ---------- Meta ----------
export const health = () => request<{ status: string }>('GET', '/health');

// ---------- Auth ----------
export interface AuthUser {
  id: string;
  email: string;
  username: string;
  role: 'admin' | 'member';
  isDisabled?: boolean;
  createdAt?: string;
  lastLoginAt?: string | null;
}
export const setupStatus = () => request<{ needsSetup: boolean }>('GET', '/api/setup/status');
export const setupAdmin = (body: { email: string; username: string; password: string }) =>
  request<AuthUser>('POST', '/api/setup', { body });
export const login = (body: { identifier: string; password: string }) =>
  request<AuthUser>('POST', '/api/auth/login', { body });
export const logout = () => request<{ ok: true }>('POST', '/api/auth/logout');
export const me = () => request<AuthUser>('GET', '/api/auth/me');
export const changePassword = (body: { currentPassword: string; newPassword: string }) =>
  request<{ ok: true }>('POST', '/api/auth/password', { body });

// ---------- Users (admin) ----------
export const listUsers = () => request<AuthUser[]>('GET', '/api/users');
export const createUser = (body: {
  email: string;
  username: string;
  password: string;
  role?: 'admin' | 'member';
}) => request<AuthUser>('POST', '/api/users', { body });
export const updateUser = (
  id: string,
  body: { role?: 'admin' | 'member'; isDisabled?: boolean },
) => request<AuthUser>('PATCH', `/api/users/${id}`, { body });
export const deleteUser = (id: string) => request<void>('DELETE', `/api/users/${id}`);
export const resetUserPassword = (id: string, newPassword: string) =>
  request<{ ok: true }>('POST', `/api/users/${id}/password`, { body: { newPassword } });
