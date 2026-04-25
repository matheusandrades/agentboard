import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { redis } from './client.js';
import { logger } from '../logger.js';

export const DISPATCH_STREAM = 'dispatch:queue';
export const DISPATCH_GROUP = 'orchestrator';

/**
 * Ensure the consumer group exists. Called once at startup; idempotent.
 */
export async function ensureDispatchGroup(client: Redis = redis): Promise<void> {
  try {
    // MKSTREAM lets us create the group before any entries exist.
    await client.xgroup('CREATE', DISPATCH_STREAM, DISPATCH_GROUP, '$', 'MKSTREAM');
    logger.info({ stream: DISPATCH_STREAM, group: DISPATCH_GROUP }, 'Created Redis consumer group');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('BUSYGROUP')) {
      // Already exists — fine.
      return;
    }
    throw err;
  }
}

/**
 * Append an entry to the dispatch queue telling someone to run a turn for
 * `agentId`. Returns the stream entry ID.
 */
export async function enqueueDispatch(
  agentId: string,
  extra: Record<string, string> = {},
  client: Redis = redis,
): Promise<string> {
  const id = await client.xadd(
    DISPATCH_STREAM,
    '*',
    'agentId',
    agentId,
    'enqueuedAt',
    new Date().toISOString(),
    ...Object.entries(extra).flat(),
  );
  return id ?? '';
}

export interface DispatchEntry {
  id: string;
  agentId: string;
  enqueuedAt?: string;
}

/**
 * Blocking XREADGROUP. Returns [] on timeout. Never throws on timeout —
 * raises only for real errors.
 *
 * `fromId`:
 *   - `'>'` (default) — get entries nobody has seen yet (normal loop case)
 *   - `'0'` or any id — get pending entries already delivered to this consumer
 *     but not ack'd (used on boot to drain leftovers from a previous crash)
 */
export async function readDispatch(
  consumerName: string,
  opts: { blockMs?: number; count?: number; fromId?: string } = {},
  client: Redis = redis,
): Promise<DispatchEntry[]> {
  const blockMs = opts.blockMs ?? 5000;
  const count = opts.count ?? 10;
  const fromId = opts.fromId ?? '>';

  // Node ioredis types for xreadgroup return unknown; we parse defensively.
  // Pending reads (fromId != '>') don't block — pass BLOCK 0 explicitly or
  // Redis will reject.
  const xargs: Array<string | number> = ['GROUP', DISPATCH_GROUP, consumerName, 'COUNT', count];
  if (fromId === '>') {
    xargs.push('BLOCK', blockMs);
  }
  xargs.push('STREAMS', DISPATCH_STREAM, fromId);

  const result = (await (client.xreadgroup as (...a: unknown[]) => Promise<unknown>)(
    ...(xargs as unknown[]),
  )) as [string, [string, string[]][]][] | null;

  if (!result) return [];

  const out: DispatchEntry[] = [];
  for (const [, entries] of result) {
    for (const [entryId, fields] of entries) {
      const map: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        const key = fields[i];
        const value = fields[i + 1];
        if (key !== undefined && value !== undefined) map[key] = value;
      }
      if (!map.agentId) continue;
      out.push({ id: entryId, agentId: map.agentId, enqueuedAt: map.enqueuedAt });
    }
  }
  return out;
}

export async function ackDispatch(entryId: string, client: Redis = redis): Promise<number> {
  return client.xack(DISPATCH_STREAM, DISPATCH_GROUP, entryId);
}

/**
 * Reclaim any entries that were delivered to a previous consumer (e.g. a
 * dead orchestrator process after a restart) but never acknowledged. Without
 * this, those entries stay pending forever on a consumer name that no longer
 * exists. Called once at dispatcher startup.
 *
 * Uses XAUTOCLAIM under the hood so we can iterate cheaply. Entries idle
 * for >= `minIdleMs` are migrated to `consumerName`.
 */
export async function reclaimStalePending(
  consumerName: string,
  opts: { minIdleMs?: number } = {},
  client: Redis = redis,
): Promise<number> {
  const minIdleMs = opts.minIdleMs ?? 30_000;
  let cursor = '0-0';
  let claimed = 0;
  // XAUTOCLAIM returns [next-cursor, [entries...], [deleted-ids...]].
  // Loop until cursor wraps back to "0-0" or no more entries to claim.
  for (let i = 0; i < 50; i++) {
    const res = (await client.xautoclaim(
      DISPATCH_STREAM,
      DISPATCH_GROUP,
      consumerName,
      minIdleMs,
      cursor,
      'COUNT',
      100,
    )) as [string, Array<[string, string[]]>, string[] | undefined] | null;
    if (!res) break;
    const [next, entries] = res;
    claimed += entries.length;
    if (!next || next === '0-0' || entries.length === 0) break;
    cursor = next;
  }
  if (claimed > 0) {
    logger.info({ consumerName, claimed, minIdleMs }, 'Reclaimed stale pending entries');
  }
  return claimed;
}

/**
 * Drop consumers that have no pending entries and are idle for a long time
 * (previous processes after a restart). Purely cosmetic cleanup — doesn't
 * affect correctness once pending entries have been reclaimed.
 */
export async function pruneDeadConsumers(
  keepConsumerName: string,
  client: Redis = redis,
): Promise<void> {
  try {
    const info = (await client.xinfo('CONSUMERS', DISPATCH_STREAM, DISPATCH_GROUP)) as
      | Array<Array<string | number>>
      | null;
    if (!info) return;
    for (const entry of info) {
      // entry is a flat [key, value, key, value, …] list
      const map: Record<string, string | number> = {};
      for (let i = 0; i < entry.length; i += 2) {
        const k = entry[i];
        const v = entry[i + 1];
        if (typeof k === 'string' && v !== undefined) map[k] = v as string | number;
      }
      const name = String(map.name ?? '');
      const pending = Number(map.pending ?? 0);
      if (!name || name === keepConsumerName) continue;
      if (pending === 0) {
        try {
          await client.xgroup('DELCONSUMER', DISPATCH_STREAM, DISPATCH_GROUP, name);
          logger.info({ consumer: name }, 'Pruned dead consumer');
        } catch {
          /* ignore */
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, 'pruneDeadConsumers failed');
  }
}

/* ----------------------------- locks ------------------------------ */

/**
 * Acquire a simple SETNX lock with TTL. Returns a token that must be passed
 * to `releaseLock` for safe release; returns null if not acquired.
 */
export async function acquireLock(
  key: string,
  ttlMs: number,
  client: Redis = redis,
): Promise<string | null> {
  const token = randomUUID();
  const res = await client.set(key, token, 'PX', ttlMs, 'NX');
  return res === 'OK' ? token : null;
}

// Small Lua script: delete key only if it matches the provided token.
const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

export async function releaseLock(
  key: string,
  token: string,
  client: Redis = redis,
): Promise<boolean> {
  const result = (await client.eval(RELEASE_LOCK_SCRIPT, 1, key, token)) as number;
  return result === 1;
}
