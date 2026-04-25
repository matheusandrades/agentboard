/**
 * Fastify auth glue:
 *  - registers @fastify/cookie
 *  - decorates request with `user: AuthedUser | null`
 *  - exposes `requireAuth` / `requireAdmin` preHandlers
 *  - exposes `needsSetupGate` that 503s every protected route until the
 *    first admin has been created (drives the install wizard)
 */
import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { count, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { COOKIE_NAME, lookupSession, type AuthedUser } from './sessions.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthedUser | null;
  }
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  await app.register(cookie, {
    // No `secret` — we only use the cookie as a transport for the opaque
    // session token, so signing buys nothing here.
  });

  // Resolve req.user once per request from the session cookie. Routes can
  // then check it via requireAuth/requireAdmin or read it directly.
  app.addHook('preHandler', async (req) => {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) {
      req.user = null;
      return;
    }
    req.user = await lookupSession(token);
  });
}

/* ----------------------------- guards ----------------------------- */

export function requireAuth(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!req.user) {
    reply.code(401).send({ error: 'unauthorized' });
    return false;
  }
  return true;
}

export function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!req.user) {
    reply.code(401).send({ error: 'unauthorized' });
    return false;
  }
  if (req.user.role !== 'admin') {
    reply.code(403).send({ error: 'forbidden', detail: 'admin role required' });
    return false;
  }
  return true;
}

/* --------------------------- setup gate --------------------------- */

let cachedSetupOk = false;

export async function hasAnyAdmin(): Promise<boolean> {
  if (cachedSetupOk) return true;
  const rows = await db
    .select({ value: count() })
    .from(users)
    .where(eq(users.role, 'admin'));
  const ok = (rows[0]?.value ?? 0) > 0;
  if (ok) cachedSetupOk = true;
  return ok;
}

/** Reset after the install wizard runs so the gate flips immediately. */
export function markSetupComplete(): void {
  cachedSetupOk = true;
}

/**
 * Routes that should still answer while the system is uninitialised
 * (status probe, the setup endpoint itself, the meta health-check).
 */
const SETUP_ALLOWLIST = new Set([
  '/api/setup/status',
  '/api/setup',
  '/health',
  '/api/health',
]);

export function isSetupAllowlisted(path: string): boolean {
  if (SETUP_ALLOWLIST.has(path)) return true;
  // The web app boots and probes /api/auth/me. While not strictly required,
  // letting it through pre-setup avoids a console error storm — we just
  // return 401 like normal.
  if (path === '/api/auth/me') return true;
  return false;
}

export async function needsSetupGate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (isSetupAllowlisted(req.routeOptions?.url ?? req.url ?? '')) return;
  if (!(await hasAnyAdmin())) {
    reply.code(503).send({ error: 'needs_setup' });
  }
}

/* ---------------------- global auth requirement ---------------------- */

// Routes that should answer without a session cookie. Anything not in this
// allowlist needs an authenticated user once setup is complete.
const PUBLIC_ROUTES = new Set([
  '/health',
  '/api/health',
  '/api/setup/status',
  '/api/setup',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/me',
  // OAuth callback comes from GitHub redirecting the user — they're
  // already logged in (the session cookie travels with the redirect),
  // but we keep this in the allowlist so the response doesn't 401 if
  // their session expired during the round-trip.
  '/api/github/oauth/callback',
  // GitHub webhook deliveries are signed by HMAC, not by our session.
  '/api/github/webhook',
]);

export async function requireSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const path = req.routeOptions?.url ?? req.url ?? '';
  if (PUBLIC_ROUTES.has(path)) return;
  // The WebSocket route is an exception — it has its own handshake auth
  // (the upgrade request still carries the cookie). Skip the http guard.
  if (path === '/ws') return;
  // We only guard /api/*. Static assets and the SPA itself are served by
  // Vite/nginx on a different process.
  if (!path.startsWith('/api/')) return;
  if (!req.user) {
    reply.code(401).send({ error: 'unauthorized' });
  }
}
