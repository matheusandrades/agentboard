/**
 * Server-side session store backed by the `sessions` table.
 *
 * The cookie carries an opaque random token (32 bytes, base64url). Truth
 * lives in the DB so revocation = row delete, no JWT key juggling.
 */
import { randomBytes } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import { db } from '../db/client.js';
import { sessions, users, type SessionRow, type UserRow } from '../db/schema.js';

export const COOKIE_NAME = 'agentboard_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type AuthRole = 'admin' | 'member';

export interface AuthedUser {
  id: string;
  email: string;
  username: string;
  role: AuthRole;
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function createSession(
  userId: string,
  meta: { userAgent?: string; ipAddress?: string } = {},
): Promise<SessionRow> {
  const id = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const [row] = await db
    .insert(sessions)
    .values({
      id,
      userId,
      expiresAt,
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ipAddress ?? null,
    })
    .returning();
  if (!row) throw new Error('Failed to create session');
  return row;
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, token));
}

export async function destroyAllSessionsFor(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function lookupSession(token: string): Promise<AuthedUser | null> {
  if (!token) return null;
  const [row] = await db
    .select({
      sessionExpires: sessions.expiresAt,
      userId: users.id,
      email: users.email,
      username: users.username,
      role: users.role,
      isDisabled: users.isDisabled,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, token))
    .limit(1);

  if (!row) return null;
  if (row.isDisabled) return null;
  if (row.sessionExpires.getTime() <= Date.now()) {
    // Lazy GC: drop the expired row so it doesn't accumulate.
    await db.delete(sessions).where(eq(sessions.id, token)).catch(() => undefined);
    return null;
  }

  return {
    id: row.userId,
    email: row.email,
    username: row.username,
    role: row.role as AuthRole,
  };
}

/** Best-effort cleanup of expired sessions; safe to call from a cron / startup. */
export async function purgeExpiredSessions(): Promise<number> {
  const result = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date()))
    .returning({ id: sessions.id });
  return result.length;
}

export function toAuthedUser(u: UserRow): AuthedUser {
  return { id: u.id, email: u.email, username: u.username, role: u.role as AuthRole };
}
