import type { FastifyInstance } from 'fastify';

import { getHelloHtml } from '../services/hello.js';
import { logger } from '../logger.js';

/**
 * Registers `GET /hello` — returns the static Hello World page authored by
 * lucas-frontend. Responds with `text/html; charset=utf-8` and a short
 * `Cache-Control` window so reverse proxies can absorb traffic spikes
 * without going stale on content updates.
 */
export async function registerHelloRoute(app: FastifyInstance): Promise<void> {
  app.get('/hello', async (_req, reply) => {
    try {
      const html = await getHelloHtml();
      reply
        .code(200)
        .header('content-type', 'text/html; charset=utf-8')
        .header('cache-control', 'public, max-age=300');
      return html;
    } catch (err) {
      logger.error({ err }, 'GET /hello failed to load page');
      reply
        .code(500)
        .header('content-type', 'application/json; charset=utf-8');
      return {
        error: 'hello_unavailable',
        message: 'Hello page is temporarily unavailable.',
      };
    }
  });
}
