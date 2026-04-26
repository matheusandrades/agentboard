/**
 * Wipe Redis state that's tied to a specific Postgres dataset so the
 * orchestrator boots clean after `pnpm db:reset`.
 *
 * Run from the repo root with:
 *   corepack pnpm --filter @agentboard/orchestrator exec tsx ../../scripts/redis_reset.ts
 *
 * Why this exists:
 *   The dispatch stream (`dispatch:queue`) holds wake-up entries keyed by
 *   agent UUIDs. After `db:reset` truncates `agents` and re-seeds them,
 *   the freshly-inserted agents get NEW UUIDs — but the stream still
 *   contains entries for the old UUIDs and consumer groups still hold
 *   pending entries for consumers that no longer exist. Result: the first
 *   1-2 dispatches after a reset misfire (alice doesn't pick up her
 *   kickoff message until the second enqueue).
 *
 * What gets cleared (idempotent — non-existent keys are silent no-ops):
 *   - `dispatch:queue`         the dispatch stream itself; deleting the
 *                              stream key automatically tears down all
 *                              consumer groups, consumers, and pending
 *                              entries attached to it.
 *   - `filelock:*`             cross-agent advisory file locks (scoped by
 *                              project + agent ids that no longer exist).
 *   - `thread-exch:*`          sliding-window counters for circular-thread
 *                              detection (keyed by thread ids that no
 *                              longer exist).
 *
 * What we deliberately DO NOT touch:
 *   - the `events:ui` pub/sub channel (no persisted state — Redis doesn't
 *     buffer published messages on a channel with no subscribers).
 *   - any keys outside the prefixes above (lets an operator share one
 *     Redis instance across multiple apps without us stomping on them).
 */
import { redis, closeRedis } from '../apps/orchestrator/src/redis/client.js';
import { DISPATCH_STREAM } from '../apps/orchestrator/src/redis/streams.js';
import { logger } from '../apps/orchestrator/src/logger.js';

const PREFIX_PATTERNS = ['filelock:*', 'thread-exch:*'];

async function deletePattern(pattern: string): Promise<number> {
  let deleted = 0;
  // SCAN is the safe iteration primitive — KEYS would block Redis on a
  // populated instance. COUNT 500 is a hint, not a hard cap.
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
    cursor = next;
    if (keys.length > 0) {
      // UNLINK is the non-blocking counterpart to DEL — same effect, frees
      // memory in a background thread. Fine to use here.
      deleted += await redis.unlink(...keys);
    }
  } while (cursor !== '0');
  return deleted;
}

export async function resetRedis(): Promise<void> {
  logger.info('Resetting Redis state for db:reset…');

  // Drop the dispatch stream entirely. DEL on a stream key wipes the
  // entries, the `orchestrator` consumer group, every consumer, and every
  // pending entry list in one shot. Idempotent.
  const streamRemoved = await redis.del(DISPATCH_STREAM);
  logger.info(
    { stream: DISPATCH_STREAM, removed: streamRemoved === 1 },
    streamRemoved === 1 ? 'Deleted dispatch stream' : 'Dispatch stream not present (already clean)',
  );

  for (const pattern of PREFIX_PATTERNS) {
    const removed = await deletePattern(pattern);
    if (removed > 0) {
      logger.info({ pattern, removed }, 'Cleared keys');
    } else {
      logger.info({ pattern }, 'No keys matched (already clean)');
    }
  }

  logger.info('Redis reset complete');
}

// Direct-run guard — only execute when invoked as a script, not when
// imported (e.g. by a test).
const isDirectRun = (() => {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    return entry.endsWith('redis_reset.ts') || entry.endsWith('redis_reset.js');
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  resetRedis()
    .then(async () => {
      await closeRedis();
      process.exit(0);
    })
    .catch(async (err) => {
      logger.error({ err }, 'Redis reset failed');
      await closeRedis().catch(() => {});
      process.exit(1);
    });
}
