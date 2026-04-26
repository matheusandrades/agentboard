/**
 * Periodic sync: when a PR opened from `agent/<name>/task-<shortId>`
 * gets merged on GitHub, mark the matching task as `done` in the
 * board. Without this the kanban drifts behind reality (cards stay
 * in `in_progress` / `review` while the code already shipped).
 *
 * Scoped: only matches branches we control (the `agent/.../task-…`
 * convention). PRs opened from random branches are ignored.
 *
 * Frequency: 60s. Cheap query — one `gh pr list --search`.
 */
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { and, eq, isNotNull, ne } from 'drizzle-orm';
import { db } from '../db/client.js';
import { tasks } from '../db/schema.js';
import { eventBus } from '../events/bus.js';
import { logger } from '../logger.js';

const execFile = promisify(execFileCb);
const POLL_INTERVAL_MS = 60_000;

interface MergedPr {
  number: number;
  headRefName: string;
}

async function listMergedPrs(): Promise<MergedPr[]> {
  try {
    const { stdout } = await execFile(
      'gh',
      [
        'pr',
        'list',
        '--state',
        'merged',
        '--limit',
        '50',
        '--json',
        'number,headRefName',
      ],
      { timeout: 15_000 },
    );
    return JSON.parse(stdout) as MergedPr[];
  } catch (err) {
    // gh not installed, no auth, no repo — silent. We'll retry.
    logger.debug({ err }, 'gh pr list failed (non-fatal)');
    return [];
  }
}

/** Extract the 8-char task shortId from a branch like `agent/<name>/task-<id>`. */
function extractShortId(branch: string): string | null {
  const m = branch.match(/(?:^|\/)task-([0-9a-f]{8})\b/i);
  return m ? m[1]!.toLowerCase() : null;
}

async function tick() {
  const merged = await listMergedPrs();
  if (merged.length === 0) return;

  // Map shortId → PR number for the merged set.
  const byShortId = new Map<string, number>();
  for (const pr of merged) {
    const sid = extractShortId(pr.headRefName);
    if (sid) byShortId.set(sid, pr.number);
  }
  if (byShortId.size === 0) return;

  // Find tasks not yet done whose id starts with one of those shortIds.
  const candidates = await db
    .select()
    .from(tasks)
    .where(and(ne(tasks.status, 'done'), isNotNull(tasks.id)));

  const promote: { id: string; pr: number }[] = [];
  for (const t of candidates) {
    const idShort = t.id.slice(0, 8).toLowerCase();
    const pr = byShortId.get(idShort);
    if (pr) promote.push({ id: t.id, pr });
  }
  if (promote.length === 0) return;

  for (const { id, pr } of promote) {
    const [updated] = await db
      .update(tasks)
      .set({ status: 'done', updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning();
    if (updated) {
      logger.info({ taskId: id, pr, title: updated.title }, 'PR sync: task → done');
      try {
        await eventBus.emit({
          type: 'task.updated',
          taskId: id,
          status: 'done',
          assigneeId: updated.assigneeId,
          at: new Date().toISOString(),
        });
      } catch (err) {
        logger.warn({ err, taskId: id }, 'PR sync: emit failed (non-fatal)');
      }
    }
  }
}

export function startPrSync(): { stop: () => void } {
  logger.info({ intervalMs: POLL_INTERVAL_MS }, 'PR sync starting');
  const interval = setInterval(() => {
    void tick().catch((err) => {
      logger.warn({ err }, 'PR sync tick failed');
    });
  }, POLL_INTERVAL_MS);
  // Run once immediately so a fresh boot doesn't wait 60s for the
  // first sync.
  void tick().catch(() => undefined);
  return {
    stop: () => clearInterval(interval),
  };
}
