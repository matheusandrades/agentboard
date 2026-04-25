/**
 * GitHub webhook receiver.
 *
 * Public endpoint (no auth — GitHub doesn't send our session cookie). We
 * verify the HMAC signature against a shared secret stored in
 * `app_settings.github.webhook` (or env GITHUB_WEBHOOK_SECRET as fallback)
 * before doing anything with the body.
 *
 * Translates a small but useful slice of GitHub events into the same UI
 * event bus the rest of the app uses + drops a notification message in
 * the relevant agent's inbox so they can react on the next turn.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eventBus } from '../events/bus.js';
import { logger } from '../logger.js';
import { getSetting } from '../lib/settings.js';
import { env } from '../config.js';
import { db } from '../db/client.js';
import { messages, projects } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { audit } from '../lib/audit.js';

interface WebhookSettings extends Record<string, unknown> {
  secret: string;
}

async function resolveSecret(): Promise<string | null> {
  const stored = await getSetting<WebhookSettings>('github.oauth');
  // We piggyback on the github.oauth row for simplicity — secret is a
  // separate field (operator can leave it empty until they're ready).
  const fromDb =
    (stored as unknown as { webhookSecret?: string } | undefined)?.webhookSecret ?? '';
  return fromDb || env.GITHUB_WEBHOOK_SECRET || null;
}

/**
 * Constant-time signature compare. GitHub sends `sha256=<hex>` in the
 * `x-hub-signature-256` header; we compute the HMAC over the raw body.
 */
function verifySignature(rawBody: Buffer, signatureHeader: string, secret: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

interface PullRequestPayload {
  action: string;
  pull_request: {
    number: number;
    title: string;
    state: string;
    draft: boolean;
    user: { login: string };
    html_url: string;
  };
  repository: { full_name: string; owner: { login: string }; name: string };
}
interface IssuePayload {
  action: string;
  issue: { number: number; title: string; state: string; user: { login: string }; html_url: string };
  repository: { full_name: string; owner: { login: string }; name: string };
}
interface PushPayload {
  ref: string;
  forced: boolean;
  pusher: { name: string };
  commits: Array<{ id: string; message: string; author: { name: string }; url: string }>;
  repository: { full_name: string; owner: { login: string }; name: string };
}
interface CheckRunPayload {
  action: string;
  check_run: {
    name: string;
    status: string;
    conclusion: string | null;
    html_url: string;
    pull_requests?: Array<{ number: number }>;
  };
  repository: { full_name: string; owner: { login: string }; name: string };
}

async function findProjectByRepo(owner: string, name: string) {
  const [p] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.repoOwner, owner), eq(projects.repoName, name)))
    .limit(1);
  return p ?? null;
}

export async function registerWebhookRoutes(app: FastifyInstance): Promise<void> {
  // Capture the raw body so we can verify the HMAC. The default JSON
  // parser stringifies-then-parses; we install a side parser that keeps
  // the raw bytes too.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      try {
        const buf = body as Buffer;
        (req as FastifyRequest & { rawBody?: Buffer }).rawBody = buf;
        const json = buf.length === 0 ? {} : JSON.parse(buf.toString('utf8'));
        done(null, json);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  app.post('/api/github/webhook', async (req, reply) => {
    const secret = await resolveSecret();
    if (!secret) {
      logger.warn('webhook received but no secret configured — rejecting');
      return reply.code(412).send({ error: 'webhook_not_configured' });
    }
    const sig = req.headers['x-hub-signature-256'];
    const raw = (req as FastifyRequest & { rawBody?: Buffer }).rawBody;
    if (!sig || typeof sig !== 'string' || !raw) {
      return reply.code(400).send({ error: 'missing_signature' });
    }
    if (!verifySignature(raw, sig, secret)) {
      return reply.code(401).send({ error: 'bad_signature' });
    }

    const event = String(req.headers['x-github-event'] ?? '').trim();
    const delivery = String(req.headers['x-github-delivery'] ?? '');
    logger.info({ event, delivery }, 'webhook received');

    try {
      await dispatch(event, req.body);
      await audit({
        kind: 'github.webhook',
        actor: null,
        payload: { event, delivery },
      });
    } catch (err) {
      logger.error({ err, event }, 'webhook dispatch failed');
    }

    // Always 200 to GitHub — failures are our problem, not theirs.
    return { ok: true };
  });

  // Convenience: tell the UI whether webhooks are configured.
  app.get('/api/github/webhook/config', async () => {
    const secret = await resolveSecret();
    return {
      configured: Boolean(secret),
      hint: env.GITHUB_WEBHOOK_SECRET ? 'env' : secret ? 'db' : null,
    };
  });

  async function dispatch(event: string, body: unknown): Promise<void> {
    if (!body || typeof body !== 'object') return;

    if (event === 'ping') return;

    if (event === 'pull_request') {
      const pl = body as PullRequestPayload;
      const project = await findProjectByRepo(pl.repository.owner.login, pl.repository.name);
      if (!project) return;
      await eventBus.emit({
        type: 'github.pull_request',
        action: pl.action,
        repo: pl.repository.full_name,
        number: pl.pull_request.number,
        title: pl.pull_request.title,
        state: pl.pull_request.state,
        author: pl.pull_request.user.login,
        url: pl.pull_request.html_url,
        at: new Date().toISOString(),
      } as never);

      // Wake QA when a PR turns ready-for-review (a non-draft "opened" or
      // a "ready_for_review" action).
      if (
        (pl.action === 'opened' && !pl.pull_request.draft) ||
        pl.action === 'ready_for_review'
      ) {
        await db.insert(messages).values({
          fromAgentId: null,
          toAgentId: null,
          type: 'review',
          subject: `PR #${pl.pull_request.number} ready for review`,
          content: `**${pl.repository.full_name}** — ${pl.pull_request.title}\n\n${pl.pull_request.html_url}\n\nOpened by ${pl.pull_request.user.login}.`,
          taskId: null,
          deliveredAt: new Date(),
        });
      }
      return;
    }

    if (event === 'push') {
      const pl = body as PushPayload;
      const project = await findProjectByRepo(pl.repository.owner.login, pl.repository.name);
      if (!project) return;
      for (const c of pl.commits) {
        await eventBus.emit({
          type: 'github.push',
          repo: pl.repository.full_name,
          ref: pl.ref,
          sha: c.id,
          message: c.message,
          author: c.author.name,
          url: c.url,
          at: new Date().toISOString(),
        } as never);
      }
      return;
    }

    if (event === 'issues') {
      const pl = body as IssuePayload;
      const project = await findProjectByRepo(pl.repository.owner.login, pl.repository.name);
      if (!project) return;
      await eventBus.emit({
        type: 'github.issue',
        action: pl.action,
        repo: pl.repository.full_name,
        number: pl.issue.number,
        title: pl.issue.title,
        author: pl.issue.user.login,
        url: pl.issue.html_url,
        at: new Date().toISOString(),
      } as never);
      return;
    }

    if (event === 'check_run') {
      const pl = body as CheckRunPayload;
      const project = await findProjectByRepo(pl.repository.owner.login, pl.repository.name);
      if (!project) return;
      await eventBus.emit({
        type: 'github.check_run',
        action: pl.action,
        repo: pl.repository.full_name,
        name: pl.check_run.name,
        status: pl.check_run.status,
        conclusion: pl.check_run.conclusion,
        url: pl.check_run.html_url,
        prNumber: pl.check_run.pull_requests?.[0]?.number ?? null,
        at: new Date().toISOString(),
      } as never);
      // Failing checks against a PR ping the team.
      if (pl.action === 'completed' && pl.check_run.conclusion === 'failure') {
        await db.insert(messages).values({
          fromAgentId: null,
          toAgentId: null,
          type: 'status',
          subject: `Check failed: ${pl.check_run.name}`,
          content: `**${pl.repository.full_name}** — ${pl.check_run.name} failed.\n\n${pl.check_run.html_url}`,
          taskId: null,
          deliveredAt: new Date(),
        });
      }
      return;
    }
  }
}
