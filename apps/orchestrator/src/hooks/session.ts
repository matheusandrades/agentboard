import { db } from '../db/client.js';
import { activityLog } from '../db/schema.js';
import { logger } from '../logger.js';

/**
 * SDK `Stop` hook. Runs when the agent finishes a turn. We log the stop
 * event so the timeline knows the agent has gone idle. The main runner
 * still does the DB-side work of persisting session_id + flipping status.
 */
export function sessionHook(agentId: string) {
  return async (input: unknown): Promise<{ continue: true }> => {
    try {
      await db.insert(activityLog).values({
        agentId,
        eventType: 'session_stop',
        payload: { info: input ?? null, at: new Date().toISOString() },
      });
    } catch (err) {
      logger.error({ err, agentId }, 'sessionHook failed');
    }
    return { continue: true };
  };
}
