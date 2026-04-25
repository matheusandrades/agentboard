import { randomUUID } from 'node:crypto';
import {
  ackDispatch,
  acquireLock,
  ensureDispatchGroup,
  pruneDeadConsumers,
  readDispatch,
  reclaimStalePending,
  releaseLock,
} from '../redis/streams.js';
import { redis } from '../redis/client.js';
import { runAgentTurn } from './runner.js';
import { logger } from '../logger.js';

interface DispatcherControls {
  stop: () => Promise<void>;
  whenStopped: Promise<void>;
}

/**
 * Infinite loop: BLOCK-read entries off `dispatch:queue`, try to acquire
 * the per-agent lock, run a turn, ack. Keeps going until `stop()` is
 * called. Never crashes the process on per-entry errors.
 */
export async function startDispatcher(): Promise<DispatcherControls> {
  await ensureDispatchGroup();

  const consumerName = `orchestrator-${process.pid}-${randomUUID().slice(0, 8)}`;
  let running = true;
  let resolveStopped: (() => void) | undefined;
  const whenStopped = new Promise<void>((r) => {
    resolveStopped = r;
  });

  logger.info({ consumerName }, 'Dispatcher starting');

  // Recover entries that belonged to a previous orchestrator process. Without
  // this, entries the old consumer delivered but never ack'd stay pending
  // forever under a dead consumer name, and agents silently miss their turn
  // after every restart.
  try {
    const claimed = await reclaimStalePending(consumerName, { minIdleMs: 15_000 });
    if (claimed > 0) {
      logger.info({ consumerName, claimed }, 'Boot: reclaimed pending entries');
    }
    await pruneDeadConsumers(consumerName);
  } catch (err) {
    logger.warn({ err }, 'Boot reclaim failed');
  }

  /**
   * Drain anything already pending on OUR consumer name (left over because
   * a previous `tsx watch` restart killed the process mid-turn). The normal
   * loop below uses `>` which only returns never-delivered entries.
   *
   * Two correctness properties here:
   *
   *  a) **Dedup by agentId.** Multiple enqueues for the same agent all do
   *     the same thing (make them read their inbox); we process one and
   *     ack the duplicates right away instead of running the SDK N times.
   *
   *  b) **Ack before processing.** Inbox messages are the source of truth —
   *     the dispatch entry is just a wake-up signal. If the processor dies
   *     mid-turn, the messages stay `unread` and the next enqueue will
   *     wake the agent again. Keeping the entry pending across crashes
   *     just inflates delivery_count without buying us anything.
   */
  async function drainPending(): Promise<void> {
    try {
      const entries = await readDispatch(consumerName, { fromId: '0', count: 500 });
      if (entries.length === 0) return;

      logger.info({ consumerName, count: entries.length }, 'Draining pending backlog');

      // Collapse into one entry per agent; ack the rest immediately.
      const byAgent = new Map<string, string>(); // agentId → first entry id
      const toAckImmediately: string[] = [];
      for (const e of entries) {
        if (byAgent.has(e.agentId)) {
          toAckImmediately.push(e.id);
        } else {
          byAgent.set(e.agentId, e.id);
        }
      }
      if (toAckImmediately.length) {
        await Promise.all(toAckImmediately.map((id) => ackDispatch(id).catch(() => 0)));
        logger.info(
          { acked: toAckImmediately.length, unique: byAgent.size },
          'Deduped pending entries',
        );
      }

      for (const [agentId, entryId] of byAgent) {
        if (!running) break;
        // Ack BEFORE running so a crash doesn't leave the entry stuck.
        // The agent's unread inbox still drives work, so we don't lose any.
        await ackDispatch(entryId).catch((err) => {
          logger.warn({ err, entryId }, 'ack before drain failed');
        });
        try {
          await redis.del(`agent:${agentId}:lock`);
        } catch {
          /* ignore */
        }
        try {
          await runAgentTurn(agentId);
        } catch (err) {
          logger.error({ err, agentId }, 'runAgentTurn threw in drainPending');
        }
      }
    } catch (err) {
      logger.warn({ err }, 'drainPending failed');
    }
  }

  // Also periodically sweep in case this process is long-lived and gets
  // killed mid-turn (lock expires after 30s, XAUTOCLAIM cleans up residue).
  const reclaimInterval = setInterval(() => {
    void reclaimStalePending(consumerName, { minIdleMs: 60_000 }).catch(() => {});
  }, 30_000);

  // Run the backlog drain before entering the normal `>` loop.
  (async () => {
    await drainPending();

    while (running) {
      try {
        const entries = await readDispatch(consumerName, { blockMs: 5000, count: 10 });
        // Same invariant as drainPending: ack up-front, so an unexpected
        // exit doesn't leak entries into the pending list.
        // Dedup per agent for the same reason: several enqueues in a burst
        // (e.g. broadcast) only need one turn.
        const byAgent = new Map<string, string>();
        const dupes: string[] = [];
        for (const e of entries) {
          if (byAgent.has(e.agentId)) dupes.push(e.id);
          else byAgent.set(e.agentId, e.id);
        }
        if (dupes.length) {
          await Promise.all(dupes.map((id) => ackDispatch(id).catch(() => 0)));
        }

        for (const [agentId, entryId] of byAgent) {
          if (!running) break;
          await ackDispatch(entryId).catch((err) => {
            logger.warn({ err, entryId }, 'XACK failed');
          });

          const lockKey = `agent:${agentId}:lock`;
          const token = await acquireLock(lockKey, 30_000);
          if (!token) {
            logger.debug({ agentId }, 'Lock busy, skipping (will be re-enqueued on next signal)');
            continue;
          }
          try {
            await runAgentTurn(agentId);
          } catch (err) {
            logger.error({ err, agentId }, 'runAgentTurn threw in dispatcher');
          } finally {
            await releaseLock(lockKey, token).catch((err) => {
              logger.warn({ err, lockKey }, 'releaseLock failed');
            });
          }
        }
      } catch (err) {
        logger.error({ err }, 'Dispatcher loop iteration failed');
        // Back off a bit so we don't burn CPU if Redis is flapping.
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    clearInterval(reclaimInterval);
    logger.info({ consumerName }, 'Dispatcher stopped');
    resolveStopped?.();
  })().catch((err) => {
    logger.error({ err }, 'Dispatcher async body crashed');
    resolveStopped?.();
  });

  return {
    async stop() {
      running = false;
      await whenStopped;
    },
    whenStopped,
  };
}
