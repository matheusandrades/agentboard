import type { FastifyInstance } from 'fastify';
import { eventBus } from '../events/bus.js';
import { logger } from '../logger.js';
import { COOKIE_NAME, lookupSession } from '../auth/sessions.js';
import { hasAnyAdmin } from '../auth/middleware.js';

/**
 * Simple /ws: on connect, subscribe to the UI event bus and forward every
 * event as JSON. Connection close unsubscribes.
 *
 * Auth: the upgrade request carries the same session cookie as normal
 * fetches. We resolve it manually (the global preHandler doesn't run on
 * the WS upgrade path). Unauthenticated clients are dropped with a 4401
 * close code unless the system isn't initialised yet.
 */
export async function registerWsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ws', { websocket: true }, async (socket, req) => {
    const peer = req.ip ?? 'unknown';

    const cookieHeader = req.headers.cookie ?? '';
    const cookies = Object.fromEntries(
      cookieHeader.split(';').map((p) => {
        const [k, ...rest] = p.trim().split('=');
        return [k, decodeURIComponent(rest.join('=') ?? '')];
      }),
    );
    const token = cookies[COOKIE_NAME] ?? '';
    const setupDone = await hasAnyAdmin();
    const user = token ? await lookupSession(token) : null;
    if (setupDone && !user) {
      logger.info({ peer }, 'WS rejected: no session');
      try {
        (socket as unknown as { close: (code: number, reason: string) => void }).close(
          4401,
          'unauthorized',
        );
      } catch {
        /* ignore */
      }
      return;
    }
    logger.info({ peer, userId: user?.id ?? null }, 'WS client connected');

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
