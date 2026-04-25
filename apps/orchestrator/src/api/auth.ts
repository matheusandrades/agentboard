/**
 * Auth + setup + user-management routes.
 *
 * Routes:
 *   GET  /api/setup/status     — { needsSetup: boolean }
 *   POST /api/setup            — first-run wizard creates the initial admin
 *   POST /api/auth/login       — sets session cookie
 *   POST /api/auth/logout      — clears it
 *   GET  /api/auth/me          — current user or 401
 *   POST /api/auth/password    — change own password
 *   GET  /api/users            — admin: list users
 *   POST /api/users            — admin: invite/create user
 *   PATCH /api/users/:id       — admin: edit role / disable
 *   DELETE /api/users/:id      — admin: delete user (cascades sessions)
 *   POST /api/users/:id/password — admin: reset another user's password
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { eq, count, and, ne } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import {
  COOKIE_NAME,
  SESSION_TTL_MS,
  createSession,
  destroyAllSessionsFor,
  destroySession,
} from '../auth/sessions.js';
import {
  hasAnyAdmin,
  markSetupComplete,
  requireAdmin,
  requireAuth,
} from '../auth/middleware.js';
import { logger } from '../logger.js';
import { audit } from '../lib/audit.js';

const ROLES = ['admin', 'member'] as const;
type Role = (typeof ROLES)[number];

const emailSchema = z.string().trim().toLowerCase().email().max(255);
const usernameSchema = z
  .string()
  .trim()
  .min(2)
  .max(50)
  .regex(/^[a-zA-Z0-9_.-]+$/, 'username may only contain letters, digits, _ . -');
const passwordSchema = z.string().min(8).max(200);

const setupSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
});
const loginSchema = z.object({
  // Accept either email or username on login.
  identifier: z.string().min(1).max(255),
  password: z.string().min(1).max(200),
});
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});
const createUserSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
  role: z.enum(ROLES).default('member'),
});
const patchUserSchema = z.object({
  role: z.enum(ROLES).optional(),
  isDisabled: z.boolean().optional(),
});
const adminResetPasswordSchema = z.object({ newPassword: passwordSchema });

function safeUser(u: {
  id: string;
  email: string;
  username: string;
  role: string;
  isDisabled: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
}) {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    role: u.role as Role,
    isDisabled: u.isDisabled,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  };
}

function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(COOKIE_NAME, { path: '/' });
}

/* -------------------- Login throttle (in-memory) ------------------- *
 * 10 wrong attempts per identifier per 15 min triggers a 1-min cool-off.
 * For self-hosted single-tenant this is plenty; trade up to Redis if we
 * ever go multi-instance.                                              */
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const FAIL_LIMIT = 10;
const COOLDOWN_MS = 60 * 1000;
const failures = new Map<string, { count: number; firstAt: number; lockedUntil: number }>();

function checkThrottle(key: string): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now();
  const e = failures.get(key);
  if (e && e.lockedUntil > now) {
    return { ok: false, retryAfter: Math.ceil((e.lockedUntil - now) / 1000) };
  }
  return { ok: true };
}

function recordFailure(key: string): void {
  const now = Date.now();
  const e = failures.get(key);
  if (!e || now - e.firstAt > FAIL_WINDOW_MS) {
    failures.set(key, { count: 1, firstAt: now, lockedUntil: 0 });
    return;
  }
  e.count += 1;
  if (e.count >= FAIL_LIMIT) {
    e.lockedUntil = now + COOLDOWN_MS;
    e.count = 0;
    e.firstAt = now;
  }
}

function clearFailures(key: string): void {
  failures.delete(key);
}

/* ----------------------------- routes ------------------------------ */
export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/setup/status', async () => {
    return { needsSetup: !(await hasAnyAdmin()) };
  });

  app.post('/api/setup', async (req, reply) => {
    if (await hasAnyAdmin()) {
      return reply.code(409).send({ error: 'already_initialised' });
    }
    const parsed = setupSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid', detail: parsed.error.flatten() });
    }
    const { email, username, password } = parsed.data;
    const passwordHash = await hashPassword(password);
    const [created] = await db
      .insert(users)
      .values({ email, username, passwordHash, role: 'admin', lastLoginAt: new Date() })
      .returning();
    if (!created) return reply.code(500).send({ error: 'create_failed' });
    markSetupComplete();

    const session = await createSession(created.id, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    setSessionCookie(reply, session.id);

    await audit({ kind: 'user.created', actor: created.id, payload: { role: 'admin', via: 'setup' } });
    logger.info({ userId: created.id, username, email }, 'Initial admin created via setup wizard');
    return safeUser(created);
  });

  /* ---------------------------- login --------------------------- */
  app.post('/api/auth/login', async (req, reply) => {
    if (!(await hasAnyAdmin())) {
      return reply.code(503).send({ error: 'needs_setup' });
    }
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid' });
    const { identifier, password } = parsed.data;
    const key = `${req.ip}:${identifier.toLowerCase()}`;
    const throttle = checkThrottle(key);
    if (!throttle.ok) {
      reply.header('retry-after', String(throttle.retryAfter));
      return reply.code(429).send({ error: 'too_many_attempts', retryAfter: throttle.retryAfter });
    }

    const looksLikeEmail = identifier.includes('@');
    const lookupCol = looksLikeEmail ? users.email : users.username;
    const [row] = await db
      .select()
      .from(users)
      .where(eq(lookupCol, identifier.trim().toLowerCase()))
      .limit(1);

    // Constant-ish time: always run the verify against either the real
    // hash or a dummy hash so timing doesn't leak whether the user exists.
    const dummy =
      'scrypt$16384$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
    const ok = await verifyPassword(password, row?.passwordHash ?? dummy);
    if (!row || !ok || row.isDisabled) {
      recordFailure(key);
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    clearFailures(key);

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, row.id));
    const session = await createSession(row.id, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    setSessionCookie(reply, session.id);

    await audit({ kind: 'user.login', actor: row.id, payload: { ip: req.ip } });
    return safeUser({ ...row, lastLoginAt: new Date() });
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies?.[COOKIE_NAME];
    if (token) await destroySession(token).catch(() => undefined);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized' });
    return req.user;
  });

  app.post('/api/auth/password', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid' });
    const me = req.user!;
    const [row] = await db.select().from(users).where(eq(users.id, me.id)).limit(1);
    if (!row) return reply.code(404).send({ error: 'user_not_found' });
    const ok = await verifyPassword(parsed.data.currentPassword, row.passwordHash);
    if (!ok) return reply.code(401).send({ error: 'invalid_credentials' });
    const passwordHash = await hashPassword(parsed.data.newPassword);
    await db.update(users).set({ passwordHash }).where(eq(users.id, me.id));
    // Invalidate all OTHER sessions for this user but keep the current one.
    await destroyAllSessionsFor(me.id);
    const session = await createSession(me.id, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    setSessionCookie(reply, session.id);
    await audit({ kind: 'user.password_changed', actor: me.id, payload: {} });
    return { ok: true };
  });

  /* --------------------------- users (admin) --------------------------- */
  app.get('/api/users', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const rows = await db.select().from(users);
    return rows.map(safeUser);
  });

  app.post('/api/users', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid', detail: parsed.error.flatten() });
    }
    const passwordHash = await hashPassword(parsed.data.password);
    try {
      const [created] = await db
        .insert(users)
        .values({
          email: parsed.data.email,
          username: parsed.data.username,
          passwordHash,
          role: parsed.data.role,
        })
        .returning();
      if (!created) return reply.code(500).send({ error: 'create_failed' });
      await audit({
        kind: 'user.created',
        actor: req.user!.id,
        payload: { targetUserId: created.id, role: created.role },
      });
      return safeUser(created);
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (/unique/i.test(msg)) {
        return reply.code(409).send({ error: 'already_exists' });
      }
      logger.error({ err }, 'create user failed');
      return reply.code(500).send({ error: 'create_failed' });
    }
  });

  app.patch('/api/users/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const id = (req.params as { id: string }).id;
    if (!z.string().uuid().safeParse(id).success) {
      return reply.code(400).send({ error: 'invalid_id' });
    }
    const parsed = patchUserSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid' });

    // Don't let the last admin demote / disable themselves.
    if (parsed.data.role === 'member' || parsed.data.isDisabled === true) {
      const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      if (target?.role === 'admin') {
        const adminRows = await db
          .select({ value: count() })
          .from(users)
          .where(and(eq(users.role, 'admin'), eq(users.isDisabled, false), ne(users.id, id)));
        if ((adminRows[0]?.value ?? 0) === 0) {
          return reply.code(409).send({ error: 'last_admin' });
        }
      }
    }

    const [updated] = await db.update(users).set(parsed.data).where(eq(users.id, id)).returning();
    if (!updated) return reply.code(404).send({ error: 'user_not_found' });
    if (parsed.data.isDisabled === true || parsed.data.role !== undefined) {
      await destroyAllSessionsFor(id);
    }
    await audit({
      kind: 'user.updated',
      actor: req.user!.id,
      payload: { targetUserId: id, ...parsed.data },
    });
    return safeUser(updated);
  });

  app.delete('/api/users/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const id = (req.params as { id: string }).id;
    if (!z.string().uuid().safeParse(id).success) {
      return reply.code(400).send({ error: 'invalid_id' });
    }
    if (id === req.user!.id) {
      return reply.code(409).send({ error: 'cannot_delete_self' });
    }
    const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!target) return reply.code(404).send({ error: 'user_not_found' });
    if (target.role === 'admin') {
      const adminRows = await db
        .select({ value: count() })
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.isDisabled, false), ne(users.id, id)));
      if ((adminRows[0]?.value ?? 0) === 0) {
        return reply.code(409).send({ error: 'last_admin' });
      }
    }
    await db.delete(users).where(eq(users.id, id));
    await audit({
      kind: 'user.deleted',
      actor: req.user!.id,
      payload: { targetUserId: id },
    });
    reply.code(204);
    return;
  });

  app.post('/api/users/:id/password', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const id = (req.params as { id: string }).id;
    if (!z.string().uuid().safeParse(id).success) {
      return reply.code(400).send({ error: 'invalid_id' });
    }
    const parsed = adminResetPasswordSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid' });
    const passwordHash = await hashPassword(parsed.data.newPassword);
    const [updated] = await db
      .update(users)
      .set({ passwordHash })
      .where(eq(users.id, id))
      .returning();
    if (!updated) return reply.code(404).send({ error: 'user_not_found' });
    await destroyAllSessionsFor(id);
    await audit({
      kind: 'user.password_reset',
      actor: req.user!.id,
      payload: { targetUserId: id },
    });
    return { ok: true };
  });
}
