import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';

import { env } from './config.js';
import { logger } from './logger.js';
import { registerHttpRoutes } from './api/http.js';
import { registerHelloRoute } from './api/hello.js';
import { registerWsRoutes } from './api/ws.js';
import { registerAuthRoutes } from './api/auth.js';
import { registerAuth, needsSetupGate, requireSession } from './auth/middleware.js';
import { startDispatcher } from './agents/dispatcher.js';
import { startNotificationDispatcher } from './notifications/dispatcher.js';
import { ensureDispatchGroup } from './redis/streams.js';
import { purgeExpiredSessions } from './auth/sessions.js';
import { closeDb } from './db/client.js';
import { closeRedis } from './redis/client.js';

async function buildApp() {
  // Note: we deliberately don't pass our custom pino instance to Fastify's
  // `loggerInstance` option because it shifts the FastifyInstance's generic
  // type away from FastifyBaseLogger and breaks type compatibility with
  // plugins. Our `logger` (imported from ./logger) is used everywhere else.
  const app = Fastify({
    logger: false,
    disableRequestLogging: true,
    trustProxy: true,
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const allowed = new Set([env.VITE_WEB_URL, 'http://localhost:5173']);
      cb(null, allowed.has(origin));
    },
    credentials: true,
  });

  await app.register(websocket);

  // Auth must be registered BEFORE routes so the `req.user` decoration
  // and the needsSetup gate apply to every handler.
  await registerAuth(app);
  app.addHook('preHandler', needsSetupGate);
  app.addHook('preHandler', requireSession);

  await registerAuthRoutes(app);
  await registerHttpRoutes(app);
  await registerHelloRoute(app);
  await registerWsRoutes(app);

  return app;
}

async function main() {
  logger.info({ env: env.NODE_ENV, port: env.ORCHESTRATOR_PORT }, 'Starting orchestrator');

  // Make sure the Redis consumer group exists before routes try to enqueue.
  try {
    await ensureDispatchGroup();
  } catch (err) {
    logger.error({ err }, 'Failed to create Redis consumer group');
  }

  const app = await buildApp();

  await app.listen({
    host: env.ORCHESTRATOR_HOST,
    port: env.ORCHESTRATOR_PORT,
  });

  logger.info({ port: env.ORCHESTRATOR_PORT }, 'Orchestrator HTTP+WS listening');

  // Start the dispatcher loop (non-blocking).
  const dispatcher = await startDispatcher();

  // Outbound notifications fan-out (Slack/Discord/etc).
  const stopNotifications = await startNotificationDispatcher();

  /* --------------------------- graceful shutdown --------------------- */
  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down…');
    try {
      await dispatcher.stop();
    } catch (err) {
      logger.warn({ err }, 'Dispatcher stop failed');
    }
    try {
      stopNotifications();
    } catch {
      /* ignore */
    }
    try {
      await app.close();
    } catch (err) {
      logger.warn({ err }, 'Fastify close failed');
    }
    try {
      await closeRedis();
    } catch (err) {
      logger.warn({ err }, 'Redis close failed');
    }
    try {
      await closeDb();
    } catch (err) {
      logger.warn({ err }, 'DB close failed');
    }
    logger.info('Shutdown complete');
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaughtException');
  });
  process.on('unhandledRejection', (err) => {
    logger.error({ err }, 'unhandledRejection');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'Orchestrator failed to start');
  process.exit(1);
});
