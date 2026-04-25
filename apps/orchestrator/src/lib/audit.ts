import { createHash } from 'node:crypto';
import { desc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { auditEvents } from '../db/schema.js';
import { logger } from '../logger.js';

/**
 * Append a hash-chained audit event. Each row's `prev_hash` equals the hash
 * of the row inserted immediately before it; the row's own `hash` covers
 * `(prev_hash, kind, actor, payload)`. Tampering with any row invalidates
 * the chain from that point on.
 */
export async function audit(opts: {
  kind: string;
  actor?: string | null;
  payload: Record<string, unknown>;
}): Promise<void> {
  try {
    const [last] = await db
      .select({ hash: auditEvents.hash })
      .from(auditEvents)
      .orderBy(desc(auditEvents.id))
      .limit(1);
    const prevHash = last?.hash ?? null;
    const payloadStr = JSON.stringify(opts.payload, Object.keys(opts.payload).sort());
    const h = createHash('sha256');
    h.update(prevHash ?? '');
    h.update('\n');
    h.update(opts.kind);
    h.update('\n');
    h.update(opts.actor ?? '');
    h.update('\n');
    h.update(payloadStr);
    const hash = h.digest('hex');
    await db.insert(auditEvents).values({
      kind: opts.kind,
      actor: opts.actor ?? null,
      payload: opts.payload,
      prevHash,
      hash,
    });
  } catch (err) {
    // Never let audit failure crash the caller — log and continue.
    logger.warn({ err, kind: opts.kind }, 'audit insert failed');
  }
}

/**
 * Walk the chain forwards verifying each row's hash against (prev_hash,
 * kind, actor, payload). Returns the row id of the first mismatch, or null
 * if the chain is clean.
 */
export async function verifyAuditChain(): Promise<{ ok: true } | { ok: false; brokenAtId: number }> {
  const rows = await db.select().from(auditEvents).orderBy(auditEvents.id);
  let prev: string | null = null;
  for (const r of rows) {
    const payloadStr = JSON.stringify(
      r.payload,
      Object.keys(r.payload as Record<string, unknown>).sort(),
    );
    const h = createHash('sha256');
    h.update(prev ?? '');
    h.update('\n');
    h.update(r.kind);
    h.update('\n');
    h.update(r.actor ?? '');
    h.update('\n');
    h.update(payloadStr);
    const expected = h.digest('hex');
    if (expected !== r.hash) {
      return { ok: false, brokenAtId: r.id };
    }
    if (r.prevHash !== prev) {
      return { ok: false, brokenAtId: r.id };
    }
    prev = r.hash;
  }
  return { ok: true };
}
