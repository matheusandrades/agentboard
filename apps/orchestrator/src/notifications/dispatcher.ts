import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { notifications } from '../db/schema.js';
import { eventBus } from '../events/bus.js';
import { logger } from '../logger.js';
import type { UIEvent } from '@agentboard/shared';

/**
 * Subscribes once to the eventBus and fans every event out to any enabled
 * webhook configured in the `notifications` table.
 *
 * The default `template: 'slack'` produces a Slack/Discord/Teams-friendly
 * payload (`{ text }`). For arbitrary tools, set `template: 'generic'` and
 * we'll send the raw event as JSON.
 */

export async function startNotificationDispatcher(): Promise<() => void> {
  return eventBus.on(async (event) => {
    try {
      const targets = await db.select().from(notifications).where(eq(notifications.enabled, true));
      for (const t of targets) {
        const kinds = (t.kinds ?? []) as string[];
        if (kinds.length && !kinds.includes(event.type)) continue;
        const text = renderText(event);
        if (!text) continue;
        const body = t.template === 'generic' ? event : { text };
        try {
          await fetch(t.targetUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
        } catch (err) {
          logger.warn(
            { err, target: t.label },
            'notification webhook delivery failed',
          );
        }
      }
    } catch (err) {
      logger.warn({ err }, 'notifications dispatch loop error');
    }
  });
}

function renderText(event: UIEvent): string | null {
  switch (event.type) {
    case 'agent.status':
      return event.status === 'error' || event.status === 'blocked'
        ? `[!] *${event.agentId.slice(0, 8)}* is **${event.status}**`
        : null; // routine status changes — too chatty
    case 'task.created':
      return `[NEW] Task: *${event.title}*`;
    case 'task.updated':
      return `[TASK] Moved to **${event.status}**`;
    case 'message.sent':
      return `[MSG] ${event.subject}`;
    case 'commit.created':
      return `[COMMIT] \`${event.sha.slice(0, 7)}\` ${event.message}`;
    case 'approval.requested':
      return `[APPROVAL] Needed: *${event.title}*`;
    case 'approval.resolved':
      return `[APPROVAL] ${event.status}`;
    default:
      return null;
  }
}
