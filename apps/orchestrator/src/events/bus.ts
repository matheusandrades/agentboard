import type { UIEvent } from '@agentboard/shared';
import { publishUI, subscribeUI, type UIEventHandler } from '../redis/pubsub.js';

/**
 * Typed, tiny wrapper around the Redis pub/sub layer so the rest of the
 * codebase has a single place to emit + subscribe to UI-facing events.
 *
 * Both DB-writing code paths (routes, MCP tools, hooks) and WS handlers
 * call into this bus rather than importing pubsub directly.
 */
export const eventBus = {
  emit(event: UIEvent): Promise<number> {
    return publishUI(event);
  },
  async on(handler: UIEventHandler): Promise<() => void> {
    return subscribeUI(handler);
  },
};

export type EventBus = typeof eventBus;
