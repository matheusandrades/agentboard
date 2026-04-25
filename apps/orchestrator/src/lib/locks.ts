import { redis } from '../redis/client.js';
import { logger } from '../logger.js';

/**
 * Advisory file locks shared across agents. Prevents two agents from
 * stomping on the same file in the same project — e.g. one updating a
 * route while another rewrites the schema it depends on.
 *
 * Locks are scoped by `projectId:filePath`. We store the holder agent's id
 * with a TTL so a crashed agent doesn't deadlock the team. Agents are
 * expected to refresh as they work; the wrapper helpers below do that.
 */

const LOCK_TTL_MS = 60_000;

const key = (projectId: string, filePath: string) =>
  `filelock:${projectId}:${filePath}`;

export async function tryFileLock(opts: {
  projectId: string;
  filePath: string;
  agentId: string;
}): Promise<{ acquired: boolean; heldBy?: string }> {
  const k = key(opts.projectId, opts.filePath);
  const result = await redis.set(k, opts.agentId, 'PX', LOCK_TTL_MS, 'NX');
  if (result === 'OK') return { acquired: true };
  const heldBy = (await redis.get(k)) ?? undefined;
  return { acquired: false, heldBy };
}

export async function refreshFileLock(opts: {
  projectId: string;
  filePath: string;
  agentId: string;
}): Promise<boolean> {
  const k = key(opts.projectId, opts.filePath);
  const cur = await redis.get(k);
  if (cur !== opts.agentId) return false;
  await redis.pexpire(k, LOCK_TTL_MS);
  return true;
}

export async function releaseFileLock(opts: {
  projectId: string;
  filePath: string;
  agentId: string;
}): Promise<boolean> {
  const k = key(opts.projectId, opts.filePath);
  const cur = await redis.get(k);
  if (cur !== opts.agentId) {
    logger.debug({ ...opts, holder: cur }, 'releaseFileLock: not the holder, ignoring');
    return false;
  }
  await redis.del(k);
  return true;
}

/**
 * Detect circular threads — N exchanges between the same agents on the
 * same threadId in a tight window. If we ever observe one, we can break
 * the loop by forcing an `error` status on one side and surfacing it.
 *
 * The store is Redis with a sliding TTL; this isn't authoritative — it's
 * best-effort early warning.
 */
export async function notePairExchange(opts: {
  threadId: string;
  windowMs?: number;
}): Promise<number> {
  const winMs = opts.windowMs ?? 120_000;
  const k = `thread-exch:${opts.threadId}`;
  const n = await redis.incr(k);
  if (n === 1) await redis.pexpire(k, winMs);
  return n;
}
