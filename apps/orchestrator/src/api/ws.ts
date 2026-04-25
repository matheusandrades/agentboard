import type { FastifyInstance } from 'fastify';
import { eventBus } from '../events/bus.js';
import { logger } from '../logger.js';

/**
 * Simple /ws: on connect, subscribe to the UI event bus and forward every
 * event as JSON. Connection close unsubscribes.
 */
export async function registerWsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ws', { websocket: true }, async (socket, req) => {
    const peer = req.ip ?? 'unknown';
    logger.info({ peer }, 'WS client connected');

    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = await eventBus.on((event) => {
        try {
          // `ws` socket — fastify-websocket v11 passes the socket directly.
          (socket as unknown as { send: (data: string) => void }).send(JSON.stringify(event));
        } catch (err) {
          logger.warn({ err }, 'Failed to send WS frame');
        }
      });
    } catch (err) {
      logger.error({ err }, 'Failed to subscribe WS client');
    }

    // Initial hello so the client can confirm the socket is live.
    try {
      (socket as unknown as { send: (data: string) => void }).send(
        JSON.stringify({ type: 'hello', at: new Date().toISOString() }),
      );
    } catch {
      /* ignore */
    }

    (socket as unknown as { on: (ev: string, cb: (...a: unknown[]) => void) => void }).on(
      'close',
      () => {
        logger.info({ peer }, 'WS client disconnected');
        unsubscribe?.();
      },
    );

    (socket as unknown as { on: (ev: string, cb: (...a: unknown[]) => void) => void }).on(
      'error',
      (err: unknown) => {
        logger.warn({ err, peer }, 'WS socket error');
      },
    );
  });
}
