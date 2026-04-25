import type { UIEvent } from '@agentboard/shared';
import { redis, redisSubscriber } from './client.js';
import { logger } from '../logger.js';

export const UI_CHANNEL = 'events:ui';

export async function publishUI(event: UIEvent): Promise<number> {
  try {
    return await redis.publish(UI_CHANNEL, JSON.stringify(event));
  } catch (err) {
    logger.error({ err, event }, 'Failed to publish UI event');
    return 0;
  }
}

export type UIEventHandler = (event: UIEvent) => void;

let globalSubscribed = false;
const handlers = new Set<UIEventHandler>();

async function ensureSubscribed(): Promise<void> {
  if (globalSubscribed) return;
  globalSubscribed = true;

  redisSubscriber.on('message', (channel, message) => {
    if (channel !== UI_CHANNEL) return;
    let parsed: UIEvent | undefined;
    try {
      parsed = JSON.parse(message) as UIEvent;
    } catch (err) {
      logger.warn({ err, message }, 'Failed to parse UI event');
      return;
    }
    for (const handler of handlers) {
      try {
        handler(parsed);
      } catch (err) {
        logger.error({ err }, 'UI event handler threw');
      }
    }
  });

  await redisSubscriber.subscribe(UI_CHANNEL);
  logger.info({ channel: UI_CHANNEL }, 'Subscribed to UI events');
}

/**
 * Register a handler for UI events. Returns an unsubscribe function.
 */
export async function subscribeUI(handler: UIEventHandler): Promise<() => void> {
  await ensureSubscribed();
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}
