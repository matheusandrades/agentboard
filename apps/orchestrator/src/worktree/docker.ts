import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../logger.js';

const execFileP = promisify(execFile);

async function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeout?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  return execFileP(cmd, args, {
    cwd: opts.cwd,
    maxBuffer: 10 * 1024 * 1024,
    timeout: opts.timeout ?? 120_000,
  });
}

/**
 * Slug-safe compose project name. Docker won't accept arbitrary chars in
 * project names, so we down-case and strip anything non-alnum.
 */
export function sanitizeProjectName(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'preview'
  );
}

export interface LaunchedPreview {
  projectName: string;
  service: string | null;
  containerId: string;
  hostPort: number;
  internalPort: number | null;
  workdir: string;
}

/**
 * Launch a preview for an agent's worktree. Priority:
 *   1. If docker-compose.yml or compose.yml exists → `docker compose up -d --build`.
 *   2. Else if Dockerfile exists → `docker build` + `docker run -d -P`.
 * Returns the host-side port + container id so the UI can build a URL.
 *
 * Throws with a clean message on any failure — caller decides how to surface.
 */
export async function launchPreview(opts: {
  workdir: string;
  agentName: string;
  projectHint?: string;
  preferredService?: string;
}): Promise<LaunchedPreview> {
  const { workdir, agentName, preferredService } = opts;

  const exists = async (p: string): Promise<boolean> => {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  };

  const composeCandidates = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
  let composePath: string | null = null;
  for (const name of composeCandidates) {
    if (await exists(path.join(workdir, name))) {
      composePath = name;
      break;
    }
  }

  const dockerfilePath = (await exists(path.join(workdir, 'Dockerfile'))) ? 'Dockerfile' : null;
  if (!composePath && !dockerfilePath) {
    throw new Error(
      'No Dockerfile or docker-compose.yml found in the worktree. Create one before calling launch_preview.',
    );
  }

  const projectName = sanitizeProjectName(opts.projectHint ?? `agentboard-${agentName}`);

  // ── Path A: compose ──────────────────────────────────────────────
  if (composePath) {
    logger.info({ workdir, composePath, projectName }, 'docker compose up');
    await run('docker', ['compose', '-p', projectName, '-f', composePath, 'up', '-d', '--build'], {
      cwd: workdir,
      timeout: 600_000, // 10min — build can be slow
    });

    // Find running containers under this project and pick the one with an
    // exposed port. If `preferredService` is provided, match that first.
    const { stdout: psOut } = await run('docker', [
      'compose',
      '-p',
      projectName,
      '-f',
      composePath,
      'ps',
      '--format',
      'json',
    ], { cwd: workdir });

    const services = parseDockerJsonLines(psOut);
    const sorted = preferredService
      ? [...services].sort((a, b) => (a.Service === preferredService ? -1 : b.Service === preferredService ? 1 : 0))
      : services;

    for (const svc of sorted) {
      const mapping = await firstExposedPort(svc.ID);
      if (mapping) {
        return {
          projectName,
          service: svc.Service ?? null,
          containerId: svc.ID,
          hostPort: mapping.host,
          internalPort: mapping.container,
          workdir,
        };
      }
    }

    throw new Error(
      `docker compose came up but no service has an exposed port. Add a "ports:" mapping to one of the services.`,
    );
  }

  // ── Path B: Dockerfile only ──────────────────────────────────────
  const tag = `agentboard/${projectName}:dev`;
  logger.info({ workdir, tag }, 'docker build');
  await run('docker', ['build', '-t', tag, '.'], {
    cwd: workdir,
    timeout: 600_000,
  });

  // Kill any old container with the same name so repeated previews don't
  // collide on port or name.
  const containerName = `agentboard-preview-${projectName}`;
  try {
    await run('docker', ['rm', '-f', containerName]);
  } catch {
    /* ignore */
  }

  const { stdout: runOut } = await run('docker', [
    'run',
    '-d',
    '--name',
    containerName,
    '-P', // publish all exposed ports to random host ports
    tag,
  ]);
  const containerId = runOut.trim();

  const mapping = await firstExposedPort(containerId);
  if (!mapping) {
    throw new Error(
      'Image built and started, but no port is exposed. Add `EXPOSE <port>` to your Dockerfile.',
    );
  }

  return {
    projectName,
    service: null,
    containerId,
    hostPort: mapping.host,
    internalPort: mapping.container,
    workdir,
  };
}

export async function stopPreview(opts: {
  containerId: string;
  projectName?: string;
  workdir?: string;
  composeFile?: string;
}): Promise<void> {
  const { containerId, projectName, workdir } = opts;
  // If we know the compose project, bring it down cleanly. Otherwise just
  // stop/remove the container.
  if (projectName && workdir) {
    try {
      await run('docker', ['compose', '-p', projectName, 'down'], { cwd: workdir });
      return;
    } catch (err) {
      logger.warn({ err }, 'compose down failed, falling back to docker rm');
    }
  }
  try {
    await run('docker', ['rm', '-f', containerId]);
  } catch (err) {
    logger.warn({ err, containerId }, 'docker rm failed');
  }
}

/* ───────── helpers ───────── */

interface DockerPs {
  ID: string;
  Name?: string;
  Service?: string;
  State?: string;
}

function parseDockerJsonLines(raw: string): DockerPs[] {
  const out: DockerPs[] = [];
  // `docker compose ps --format json` newer versions emit JSON lines, older
  // versions emit a JSON array. Support both.
  const trimmed = raw.trim();
  if (!trimmed) return out;
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed) as DockerPs[];
      return arr;
    } catch {
      return out;
    }
  }
  for (const line of trimmed.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as DockerPs);
    } catch {
      /* skip */
    }
  }
  return out;
}

/**
 * Parse `docker inspect` and return the first (host,container) port pair.
 * Example output: `{ "80/tcp": [{ "HostIp": "0.0.0.0", "HostPort": "55123" }] }`
 */
async function firstExposedPort(
  containerId: string,
): Promise<{ host: number; container: number } | null> {
  try {
    const { stdout } = await run('docker', [
      'inspect',
      '--format',
      '{{json .NetworkSettings.Ports}}',
      containerId,
    ]);
    const parsed = JSON.parse(stdout) as Record<
      string,
      Array<{ HostIp: string; HostPort: string }> | null
    >;
    for (const [key, bindings] of Object.entries(parsed)) {
      if (!bindings || bindings.length === 0) continue;
      const binding = bindings[0];
      if (!binding?.HostPort) continue;
      const container = Number((key.split('/')[0] ?? '0').trim());
      const host = Number(binding.HostPort);
      if (Number.isFinite(host) && host > 0) return { host, container };
    }
  } catch (err) {
    logger.warn({ err, containerId }, 'docker inspect failed');
  }
  return null;
}
