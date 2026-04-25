import { db } from '../db/client.js';
import { activityLog } from '../db/schema.js';
import { eventBus } from '../events/bus.js';
import { logger } from '../logger.js';

/**
 * SDK hook callback. The SDK contract (see ARCHITECTURE §9) passes the
 * tool invocation details as `input`. We persist them to `activity_log`
 * and publish an `activity` event to the UI bus. Never throws — logs
 * and returns `{ continue: true }`.
 */
export function activityHook(agentId: string) {
  return async (input: unknown, toolUseID?: unknown): Promise<{ continue: true }> => {
    try {
      const i = (input ?? {}) as {
        tool_name?: string;
        tool_input?: unknown;
        tool_response?: unknown;
      };
      const toolName = typeof i.tool_name === 'string' ? i.tool_name : 'unknown';

      await db.insert(activityLog).values({
        agentId,
        eventType: 'tool_call',
        payload: {
          tool: toolName,
          toolUseID: toolUseID ?? null,
          args: i.tool_input ?? null,
          result: i.tool_response ?? null,
        },
      });

      await eventBus.emit({
        type: 'activity',
        agentId,
        tool: toolName,
        at: new Date().toISOString(),
      });
    } catch (err) {
      logger.error({ err, agentId }, 'activityHook failed');
    }
    return { continue: true };
  };
}
