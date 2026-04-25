import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { githubConnections, type GithubConnectionRow } from '../db/schema.js';
import { paths } from '../config.js';
import { logger } from '../logger.js';

const execFileP = promisify(execFile);

async function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  return execFileP(cmd, args, {
    cwd: opts.cwd,
    env: opts.env,
    maxBuffer: 20 * 1024 * 1024,
    timeout: opts.timeout ?? 60_000,
  });
}

/**
 * Detect how the orchestrator can talk to GitHub right now:
 *   1. Saved 'pat' row (explicit token stored by the user in settings)
 *   2. `gh` CLI logged in on the host (picks up SSO, GitHub Apps, etc)
 *   3. No connection.
 *
 * Returns the active row (creating/updating the 'gh' row on the fly so
 * the UI can read a stable source of truth).
 */
export type GithubMode = 'gh' | 'pat' | 'oauth' | 'app';

export interface GithubStatus {
  connected: boolean;
  mode: GithubMode | null;
  login: string | null;
  scopes: string[] | null;
  detail?: string;
}

/**
 * Resolve the active connection. We pick the highest-fidelity mode
 * available, in this order: oauth → pat → gh. Stops at the first row
 * found so the operator can override `gh` by saving a PAT or OAuthing.
 */
async function pickActiveConnection() {
  const rows = await db.select().from(githubConnections);
  return (
    rows.find((r) => r.mode === 'oauth' && r.accessToken) ??
    rows.find((r) => r.mode === 'app' && r.accessToken) ??
    rows.find((r) => r.mode === 'pat' && r.accessToken) ??
    rows.find((r) => r.mode === 'gh') ??
    null
  );
}

export async function getGithubStatus(): Promise<GithubStatus> {
  const active = await pickActiveConnection();

  // Verify any token-bearing connection actually works against GitHub.
  if (active?.accessToken && active.mode !== 'gh') {
    try {
      const login = await whoAmIWithToken(active.accessToken);
      return {
        connected: true,
        mode: active.mode as GithubMode,
        login,
        scopes: active.scopes ? active.scopes.split(/[,\s]+/).filter(Boolean) : null,
      };
    } catch (err) {
      return {
        connected: false,
        mode: active.mode as GithubMode,
        login: active.login,
        scopes: null,
        detail: err instanceof Error ? err.message : 'token rejected by GitHub',
      };
    }
  }

  // Fall back to `gh` CLI if it's installed and logged in.
  try {
    const { stdout } = await run('gh', ['auth', 'status', '--hostname', 'github.com']);
    const login = extractLogin(stdout);
    const scopes = extractScopes(stdout);
    if (login) {
      await upsertGhConnection(login, scopes.join(','));
      return { connected: true, mode: 'gh', login, scopes };
    }
  } catch (err) {
    logger.debug({ err }, 'gh auth status failed');
  }

  return { connected: false, mode: null, login: null, scopes: null };
}

/** Returns a usable bearer token, or null when the only connection is the gh CLI. */
export async function getActiveToken(): Promise<{ token: string; mode: GithubMode } | null> {
  const active = await pickActiveConnection();
  if (!active) return null;
  if (active.mode === 'gh') return null;

  // For mode='app' the stored token is a short-lived installation
  // token. Mint a fresh one on each call so we never serve an expired
  // one (the helper caches internally).
  if (active.mode === 'app' && active.installationId) {
    try {
      const { getInstallationToken } = await import('./app.js');
      const token = await getInstallationToken(active.installationId);
      return { token, mode: 'app' };
    } catch (err) {
      logger.warn({ err }, 'Failed to mint App installation token, falling back');
    }
  }

  if (!active.accessToken) return null;
  return { token: active.accessToken, mode: active.mode as GithubMode };
}

/* ----------------------- OAuth App flow ----------------------------- */

interface OauthExchangeResult {
  accessToken: string;
  refreshToken: string | null;
  scope: string;
}

export async function exchangeOauthCode(
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string,
): Promise<OauthExchangeResult> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    throw new Error(`OAuth exchange failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as Record<string, string>;
  if (body.error || !body.access_token) {
    throw new Error(`OAuth exchange rejected: ${body.error_description ?? body.error ?? 'no token'}`);
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    scope: body.scope ?? '',
  };
}

export async function saveOauthConnection(
  accessToken: string,
  scopes: string,
  refreshToken: string | null,
): Promise<GithubStatus> {
  const login = await whoAmIWithToken(accessToken);
  const existing = (await db.select().from(githubConnections)).find((r) => r.mode === 'oauth');
  if (existing) {
    await db
      .update(githubConnections)
      .set({ login, accessToken, scopes, refreshToken })
      .where(eq(githubConnections.id, existing.id));
  } else {
    await db.insert(githubConnections).values({
      mode: 'oauth',
      login,
      accessToken,
      scopes,
      refreshToken,
    });
  }
  // Drop any older PAT/gh row so the OAuth connection wins cleanly.
  return {
    connected: true,
    mode: 'oauth',
    login,
    scopes: scopes.split(/[,\s]+/).filter(Boolean),
  };
}

export async function disconnectOauth(): Promise<void> {
  await db.delete(githubConnections).where(eq(githubConnections.mode, 'oauth'));
}

async function upsertGhConnection(login: string, scopes: string): Promise<void> {
  const [existing] = await db
    .select()
    .from(githubConnections)
    .where(eq(githubConnections.mode, 'gh'))
    .limit(1);
  if (existing) {
    await db
      .update(githubConnections)
      .set({ login, scopes })
      .where(eq(githubConnections.id, existing.id));
  } else {
    await db.insert(githubConnections).values({ mode: 'gh', login, scopes });
  }
}

function extractLogin(authStatus: string): string | null {
  const m = authStatus.match(/Logged in to github\.com account (\S+)/i);
  return m ? m[1]! : null;
}
function extractScopes(authStatus: string): string[] {
  const m = authStatus.match(/Token scopes: *([^\n]+)/i);
  if (!m) return [];
  return (m[1] ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
}

async function whoAmIWithToken(token: string): Promise<string> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'AgentBoard',
    },
  });
  if (!res.ok) throw new Error(`GitHub /user returned ${res.status}`);
  const body = (await res.json()) as { login?: string };
  if (!body.login) throw new Error('GitHub /user response missing login');
  return body.login;
}

/**
 * Store a Personal Access Token the user pasted into the Settings page.
 * Validates by calling /user before saving.
 */
export async function savePersonalAccessToken(token: string): Promise<GithubStatus> {
  const login = await whoAmIWithToken(token);
  // Scopes come back on the response header `x-oauth-scopes`.
  let scopes = '';
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'AgentBoard',
      },
    });
    scopes = res.headers.get('x-oauth-scopes') ?? '';
  } catch {
    /* ignore */
  }

  // Replace any existing PAT row for this login; keep at most one.
  await db.delete(githubConnections).where(eq(githubConnections.mode, 'pat'));
  await db
    .insert(githubConnections)
    .values({ mode: 'pat', login, accessToken: token, scopes });

  return {
    connected: true,
    mode: 'pat',
    login,
    scopes: scopes ? scopes.split(/[,\s]+/).filter(Boolean) : [],
  };
}

export async function disconnectPat(): Promise<void> {
  await db.delete(githubConnections).where(eq(githubConnections.mode, 'pat'));
}

/* ─────────────────────────── repo operations ─────────────────────────── */

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

/**
 * List repositories the user has access to. Uses `gh` CLI (richer — covers
 * orgs, fine-grained perms) when available, falling back to REST via PAT.
 */
export async function listRepos(opts: { limit?: number } = {}): Promise<RepoSummary[]> {
  const limit = opts.limit ?? 100;
  const status = await getGithubStatus();
  if (!status.connected) return [];

  if (status.mode === 'gh') {
    try {
      const { stdout } = await run('gh', [
        'repo',
        'list',
        '--limit',
        String(limit),
        '--json',
        'owner,name,nameWithOwner,description,defaultBranchRef,visibility,pushedAt,url',
      ]);
      const arr = JSON.parse(stdout) as Array<{
        owner: { login: string };
        name: string;
        nameWithOwner: string;
        description: string | null;
        defaultBranchRef?: { name: string };
        visibility: string;
        pushedAt: string | null;
        url: string;
      }>;
      return arr.map((r) => ({
        owner: r.owner.login,
        name: r.name,
        fullName: r.nameWithOwner,
        description: r.description,
        defaultBranch: r.defaultBranchRef?.name ?? 'main',
        visibility: (r.visibility?.toLowerCase() as RepoSummary['visibility']) ?? 'private',
        pushedAt: r.pushedAt,
        htmlUrl: r.url,
      }));
    } catch (err) {
      logger.warn({ err }, 'gh repo list failed, falling back to REST');
    }
  }

  // REST via OAuth or PAT (OAuth wins because pickActive prefers it).
  const active = await getActiveToken();
  if (!active) return [];
  const res = await fetch(
    `https://api.github.com/user/repos?per_page=${limit}&sort=pushed&direction=desc&affiliation=owner,collaborator,organization_member`,
    {
      headers: {
        Authorization: `Bearer ${active.token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'AgentBoard',
      },
    },
  );
  if (!res.ok) throw new Error(`GitHub /user/repos returned ${res.status}`);
  const arr = (await res.json()) as Array<{
    owner: { login: string };
    name: string;
    full_name: string;
    description: string | null;
    default_branch: string;
    visibility: string;
    pushed_at: string | null;
    html_url: string;
  }>;
  return arr.map((r) => ({
    owner: r.owner.login,
    name: r.name,
    fullName: r.full_name,
    description: r.description,
    defaultBranch: r.default_branch,
    visibility: (r.visibility?.toLowerCase() as RepoSummary['visibility']) ?? 'private',
    pushedAt: r.pushed_at,
    htmlUrl: r.html_url,
  }));
}

/**
 * Clone `owner/name` into `workspace/projects/<owner>-<name>` using whichever
 * auth mode is active. Idempotent — if the clone already exists, runs a
 * `git fetch origin` to keep it fresh.
 */
export async function cloneRepo(
  owner: string,
  name: string,
  opts: { branch?: string } = {},
): Promise<string> {
  const destRoot = path.join(paths.workspaceRoot, 'projects');
  await fs.mkdir(destRoot, { recursive: true });
  const dest = path.join(destRoot, `${owner}-${name}`);

  const already = await exists(path.join(dest, '.git'));
  if (already) {
    try {
      await run('git', ['fetch', '--all', '--prune'], { cwd: dest });
      if (opts.branch) {
        await run('git', ['checkout', opts.branch], { cwd: dest });
        await run('git', ['pull', '--ff-only', 'origin', opts.branch], { cwd: dest });
      }
    } catch (err) {
      logger.warn({ err, dest }, 'git fetch/pull failed on existing clone');
    }
    return dest;
  }

  const status = await getGithubStatus();
  if (status.mode === 'gh') {
    await run('gh', ['repo', 'clone', `${owner}/${name}`, dest], { timeout: 300_000 });
  } else if (status.mode === 'pat') {
    const [pat] = await db
      .select()
      .from(githubConnections)
      .where(eq(githubConnections.mode, 'pat'))
      .limit(1);
    if (!pat?.accessToken) throw new Error('No GitHub connection');
    const url = `https://x-access-token:${pat.accessToken}@github.com/${owner}/${name}.git`;
    await run('git', ['clone', url, dest], { timeout: 300_000 });
  } else {
    throw new Error('No GitHub connection. Connect in Settings first.');
  }

  return dest;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a branch is checked out in the repo, forking from `baseBranch`
 * (the project's default branch) the first time. Safe to call repeatedly.
 */
export async function ensureBranch(
  cwd: string,
  branch: string,
  baseBranch: string,
): Promise<void> {
  // Fetch latest base
  try {
    await run('git', ['fetch', 'origin', baseBranch, '--prune'], { cwd });
  } catch (err) {
    logger.warn({ err }, 'git fetch origin failed');
  }
  // Does the branch exist locally?
  const { stdout } = await run('git', ['branch', '--list', branch], { cwd });
  if (stdout.trim()) {
    await run('git', ['checkout', branch], { cwd });
    return;
  }
  // Does it exist on origin?
  let onOrigin = false;
  try {
    await run('git', ['rev-parse', '--verify', `origin/${branch}`], { cwd });
    onOrigin = true;
  } catch {
    onOrigin = false;
  }
  if (onOrigin) {
    await run('git', ['checkout', '-b', branch, `origin/${branch}`], { cwd });
  } else {
    await run('git', ['checkout', '-b', branch, `origin/${baseBranch}`], { cwd });
  }
}

export async function pushBranch(cwd: string, branch: string): Promise<void> {
  await run('git', ['push', '-u', 'origin', branch], { cwd, timeout: 120_000 });
}

export async function openPullRequest(opts: {
  cwd: string;
  title: string;
  body: string;
  baseBranch: string;
  headBranch: string;
}): Promise<{ number: number; url: string }> {
  const { cwd, title, body, baseBranch, headBranch } = opts;
  await pushBranch(cwd, headBranch);
  const { stdout } = await run(
    'gh',
    ['pr', 'create', '--title', title, '--body', body, '--base', baseBranch, '--head', headBranch],
    { cwd, timeout: 60_000 },
  );
  const url = stdout.trim().split('\n').pop() ?? '';
  const numMatch = url.match(/\/pull\/(\d+)/);
  const number = numMatch ? Number(numMatch[1]) : 0;
  return { number, url };
}

export async function fetchConnections(): Promise<GithubConnectionRow[]> {
  return db.select().from(githubConnections);
}

/* ───────── PRs / Issues / Branches via gh CLI (with REST fallback) ───────── */

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
  // Roll-up of all check runs: SUCCESS | FAILURE | PENDING | UNKNOWN
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

function rollupChecks(rolls: unknown): PullRequestSummary['checks'] {
  if (!Array.isArray(rolls) || rolls.length === 0) return 'UNKNOWN';
  let pending = false;
  for (const r of rolls) {
    const conclusion = String(
      (r as { conclusion?: string; status?: string }).conclusion ??
        (r as { state?: string }).state ??
        '',
    ).toUpperCase();
    if (conclusion === 'FAILURE' || conclusion === 'CANCELLED' || conclusion === 'TIMED_OUT')
      return 'FAILURE';
    if (conclusion === 'IN_PROGRESS' || conclusion === 'QUEUED' || conclusion === 'PENDING')
      pending = true;
  }
  return pending ? 'PENDING' : 'SUCCESS';
}

export async function listPullRequests(
  owner: string,
  name: string,
  state: 'open' | 'closed' | 'all' = 'all',
  limit = 50,
): Promise<PullRequestSummary[]> {
  const status = await getGithubStatus();
  if (!status.connected) return [];

  const fields = [
    'number',
    'title',
    'state',
    'isDraft',
    'author',
    'baseRefName',
    'headRefName',
    'createdAt',
    'updatedAt',
    'url',
    'labels',
    'statusCheckRollup',
    'reviewDecision',
    'additions',
    'deletions',
    'changedFiles',
  ].join(',');

  if (status.mode === 'gh') {
    try {
      const { stdout } = await run('gh', [
        'pr',
        'list',
        '--repo',
        `${owner}/${name}`,
        '--state',
        state,
        '--limit',
        String(limit),
        '--json',
        fields,
      ]);
      const arr = JSON.parse(stdout) as Array<Record<string, unknown>>;
      return arr.map((r) => ({
        number: Number(r.number),
        title: String(r.title ?? ''),
        state: String(r.state ?? 'OPEN').toUpperCase() as PullRequestSummary['state'],
        isDraft: Boolean(r.isDraft),
        author:
          typeof r.author === 'object' && r.author && 'login' in r.author
            ? String((r.author as { login?: string }).login ?? '?')
            : '?',
        baseRefName: String(r.baseRefName ?? ''),
        headRefName: String(r.headRefName ?? ''),
        createdAt: String(r.createdAt ?? ''),
        updatedAt: String(r.updatedAt ?? ''),
        url: String(r.url ?? ''),
        labels: Array.isArray(r.labels)
          ? (r.labels as Array<{ name?: string }>).map((l) => String(l.name ?? '')).filter(Boolean)
          : [],
        checks: rollupChecks(r.statusCheckRollup),
        reviewDecision:
          (r.reviewDecision as PullRequestSummary['reviewDecision']) ?? null,
        additions: Number(r.additions ?? 0),
        deletions: Number(r.deletions ?? 0),
        changedFiles: Number(r.changedFiles ?? 0),
      }));
    } catch (err) {
      logger.warn({ err, owner, name }, 'gh pr list failed');
      return [];
    }
  }

  return [];
}

export async function listIssues(
  owner: string,
  name: string,
  state: 'open' | 'closed' | 'all' = 'open',
  limit = 50,
): Promise<IssueSummary[]> {
  const status = await getGithubStatus();
  if (!status.connected) return [];

  if (status.mode === 'gh') {
    try {
      const { stdout } = await run('gh', [
        'issue',
        'list',
        '--repo',
        `${owner}/${name}`,
        '--state',
        state,
        '--limit',
        String(limit),
        '--json',
        'number,title,state,author,labels,assignees,createdAt,updatedAt,url,body,comments',
      ]);
      const arr = JSON.parse(stdout) as Array<Record<string, unknown>>;
      return arr.map((r) => ({
        number: Number(r.number),
        title: String(r.title ?? ''),
        state: String(r.state ?? 'OPEN').toUpperCase() as IssueSummary['state'],
        author:
          typeof r.author === 'object' && r.author && 'login' in r.author
            ? String((r.author as { login?: string }).login ?? '?')
            : '?',
        labels: Array.isArray(r.labels)
          ? (r.labels as Array<{ name?: string }>).map((l) => String(l.name ?? '')).filter(Boolean)
          : [],
        assignees: Array.isArray(r.assignees)
          ? (r.assignees as Array<{ login?: string }>)
              .map((a) => String(a.login ?? ''))
              .filter(Boolean)
          : [],
        createdAt: String(r.createdAt ?? ''),
        updatedAt: String(r.updatedAt ?? ''),
        url: String(r.url ?? ''),
        body: String(r.body ?? ''),
        comments: typeof r.comments === 'number' ? r.comments : 0,
      }));
    } catch (err) {
      logger.warn({ err, owner, name }, 'gh issue list failed');
      return [];
    }
  }

  return [];
}

export async function getIssue(
  owner: string,
  name: string,
  number: number,
): Promise<IssueSummary | null> {
  const list = await listIssues(owner, name, 'all', 200);
  return list.find((i) => i.number === number) ?? null;
}

/**
 * List local branches in the project clone with ahead/behind counts vs the
 * default branch. We use `git for-each-ref` + `rev-list --left-right` so we
 * don't need extra API calls.
 */
export async function listProjectBranches(
  workdir: string,
  defaultBranch: string,
): Promise<BranchSummary[]> {
  try {
    await run('git', ['fetch', '--prune', 'origin'], { cwd: workdir, timeout: 30_000 });
  } catch {
    /* keep going with whatever we have */
  }

  const { stdout } = await run(
    'git',
    [
      'for-each-ref',
      '--format=%(refname:short)\t%(objectname:short)\t%(authorname)\t%(committerdate:iso8601-strict)\t%(contents:subject)',
      'refs/remotes/origin',
    ],
    { cwd: workdir },
  );

  const out: BranchSummary[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    const [refLong, sha, author, date, ...subjParts] = line.split('\t');
    if (!refLong || refLong.endsWith('/HEAD')) continue;
    const branchName = refLong.replace(/^origin\//, '');
    if (!branchName) continue;

    let ahead = 0;
    let behind = 0;
    if (branchName !== defaultBranch) {
      try {
        const { stdout: rl } = await run(
          'git',
          ['rev-list', '--left-right', '--count', `origin/${defaultBranch}...origin/${branchName}`],
          { cwd: workdir },
        );
        const [b, a] = rl.trim().split(/\s+/).map((s) => Number(s));
        behind = b ?? 0;
        ahead = a ?? 0;
      } catch {
        /* leave 0 */
      }
    }

    out.push({
      name: branchName,
      commitSha: sha ?? '',
      commitAuthor: author ?? '',
      commitDate: date ?? '',
      commitMessage: subjParts.join('\t'),
      isProtected: branchName === defaultBranch,
      aheadOfDefault: ahead,
      behindDefault: behind,
    });
  }

  // Sort: default branch first, then by recency
  out.sort((a, b) => {
    if (a.name === defaultBranch) return -1;
    if (b.name === defaultBranch) return 1;
    return new Date(b.commitDate).getTime() - new Date(a.commitDate).getTime();
  });
  return out;
}
