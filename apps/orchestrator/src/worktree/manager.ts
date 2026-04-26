import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { paths } from '../config.js';
import { logger } from '../logger.js';

const execFileP = promisify(execFile);

async function run(cmd: string, args: string[], opts: { cwd?: string } = {}): Promise<{ stdout: string; stderr: string }> {
  return execFileP(cmd, args, { cwd: opts.cwd, maxBuffer: 10 * 1024 * 1024 });
}

async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await run('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir });
    return true;
  } catch {
    return false;
  }
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
 * Ensure the monorepo root has a git repository. If not, initialize it with
 * an empty commit so that `git worktree add` works. Idempotent.
 */
async function ensureRepo(): Promise<string> {
  const repoRoot = paths.repoRoot;

  if (await isGitRepo(repoRoot)) return repoRoot;

  logger.info({ repoRoot }, 'Repo is not a git repo; running git init');
  await run('git', ['init', '-b', 'main'], { cwd: repoRoot });

  // If there's nothing to commit, create an empty one so worktree add has
  // something to branch from.
  try {
    await run('git', ['config', 'user.email', 'agentboard@local'], { cwd: repoRoot });
    await run('git', ['config', 'user.name', 'AgentBoard'], { cwd: repoRoot });
  } catch {
    /* ignore */
  }

  try {
    await run('git', ['commit', '--allow-empty', '-m', 'chore: initial empty commit'], {
      cwd: repoRoot,
    });
  } catch (err) {
    logger.warn({ err }, 'Initial empty commit failed (may already exist)');
  }

  return repoRoot;
}

/**
 * Create a git worktree for an agent. Returns the absolute worktree path.
 * If the worktree already exists, returns its path without recreating.
 */
export async function createWorktree(agentName: string): Promise<string> {
  const repoRoot = await ensureRepo();
  await fs.mkdir(paths.workspaceRoot, { recursive: true });

  const worktreePath = path.join(paths.workspaceRoot, agentName);
  const branch = `agent/${agentName}`;

  if (await exists(worktreePath)) {
    logger.info({ worktreePath }, 'Worktree already exists, reusing');
    return worktreePath;
  }

  // Check if the branch already exists so we don't double-create it.
  let branchExists = false;
  try {
    await run('git', ['rev-parse', '--verify', branch], { cwd: repoRoot });
    branchExists = true;
  } catch {
    branchExists = false;
  }

  const args = branchExists
    ? ['worktree', 'add', worktreePath, branch]
    : ['worktree', 'add', worktreePath, '-b', branch];

  try {
    await run('git', args, { cwd: repoRoot });
    logger.info({ worktreePath, branch }, 'Created worktree');
  } catch (err) {
    logger.error({ err, worktreePath, branch }, 'Failed to create worktree');
    throw err;
  }

  // Pin the agent's git identity at the worktree level so any raw
  // `git commit` (via Bash) attributes to the agent, not to the host's
  // global config. The MCP commit_code tool also passes -c overrides
  // for safety, but this keeps `git commit -m '…'` from a Bash tool
  // call on-brand too.
  try {
    await run('git', ['config', 'user.name', agentName], { cwd: worktreePath });
    await run('git', ['config', 'user.email', `${agentName}@agentboard.local`], {
      cwd: worktreePath,
    });
  } catch (err) {
    logger.warn({ err, worktreePath }, 'Failed to set per-agent git identity (non-fatal)');
  }

  return worktreePath;
}

/**
 * Remove a worktree (and the corresponding branch will remain).
 */
export async function removeWorktree(worktreePath: string): Promise<void> {
  const repoRoot = paths.repoRoot;
  try {
    await run('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoRoot });
    logger.info({ worktreePath }, 'Removed worktree');
  } catch (err) {
    logger.warn({ err, worktreePath }, 'Failed to remove worktree');
  }
}

/**
 * Read the most recent N commits from an agent's worktree. Returns rows in
 * git-log order (newest first). Used to sync commits made via raw Bash/git
 * (not through the commit_code MCP tool) into the commits table.
 */
export async function readWorktreeCommits(
  worktreePath: string,
  limit = 50,
): Promise<Array<{ sha: string; message: string; unixTs: number; filesChanged: number; branch: string | null }>> {
  const exists = await isGitRepo(worktreePath);
  if (!exists) return [];
  // Separator: use a NUL-less sentinel since commit messages can contain anything.
  const FIELD = '\x1f';
  const RECORD = '\x1e';
  const { stdout } = await run(
    'git',
    ['log', `--pretty=format:%H${FIELD}%ct${FIELD}%s${RECORD}`, '-n', String(limit)],
    { cwd: worktreePath },
  );
  let branch: string | null = null;
  try {
    const br = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: worktreePath });
    branch = br.stdout.trim();
  } catch {
    /* ignore */
  }

  const records = stdout.split(RECORD).map((s) => s.trim()).filter(Boolean);
  const out: Array<{ sha: string; message: string; unixTs: number; filesChanged: number; branch: string | null }> = [];
  for (const rec of records) {
    const [sha, ts, message] = rec.split(FIELD);
    if (!sha || !ts) continue;
    // files changed — cheap: git show --name-only
    let filesChanged = 0;
    try {
      const st = await run('git', ['show', '--name-only', '--format=', sha], { cwd: worktreePath });
      filesChanged = st.stdout.split('\n').filter(Boolean).length;
    } catch {
      /* ignore */
    }
    out.push({ sha, message: message ?? '', unixTs: Number(ts), filesChanged, branch });
  }
  return out;
}

/**
 * Run `git add -A && git commit -m <message>` in the agent's worktree.
 * Returns the commit SHA and files changed count, or null on "nothing to commit".
 *
 * When `author` is supplied, the commit is signed under the agent's
 * identity instead of whatever the host's `git config user.name/email`
 * happens to be — so commits land in `git log` as
 * `alice-pm <alice-pm@agentboard.local>` and the human can audit which
 * agent did what without diving into the audit log.
 */
export async function commitInWorktree(
  worktreePath: string,
  message: string,
  author?: { name: string; email: string },
): Promise<{ sha: string; filesChanged: number; branch: string | null } | null> {
  // Stage everything.
  await run('git', ['add', '-A'], { cwd: worktreePath });

  // Check if there is anything staged.
  const status = await run('git', ['status', '--porcelain'], { cwd: worktreePath });
  if (status.stdout.trim().length === 0) {
    return null;
  }

  const before = await run('git', ['diff', '--cached', '--numstat'], { cwd: worktreePath });
  const filesChanged = before.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean).length;

  // Per-agent identity via `git -c user.name=... -c user.email=...`,
  // scoped to this single command — never mutates the worktree's
  // committed config.
  const idArgs = author
    ? [
        '-c',
        `user.name=${author.name}`,
        '-c',
        `user.email=${author.email}`,
      ]
    : [];
  await run('git', [...idArgs, 'commit', '-m', message], { cwd: worktreePath });
  const sha = (await run('git', ['rev-parse', 'HEAD'], { cwd: worktreePath })).stdout.trim();

  let branch: string | null = null;
  try {
    const br = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: worktreePath });
    branch = br.stdout.trim();
  } catch {
    /* ignore */
  }

  return { sha, filesChanged, branch };
}
