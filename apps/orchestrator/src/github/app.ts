/**
 * GitHub App helpers.
 *
 *   1. Manifest flow lets the operator create the App in one click —
 *      they POST a JSON manifest to GitHub, which redirects back with a
 *      `code`; we exchange it for the App's id, secrets, and private
 *      key, and save them in `app_settings.github.app`.
 *
 *   2. JWT signing: short-lived RS256 token with `iss = appId`, used to
 *      mint per-installation access tokens via
 *      POST /app/installations/:id/access_tokens.
 *
 *   3. Installation tokens are cached in-memory until they're 60s away
 *      from expiring.
 */
import jwt from 'jsonwebtoken';
import { logger } from '../logger.js';
import { getSetting, setSetting, type GithubAppSettings } from '../lib/settings.js';

const JWT_TTL_SECONDS = 9 * 60; // 9 min — GitHub allows up to 10
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;

interface CachedToken {
  token: string;
  expiresAt: number; // ms
}
const installationTokens = new Map<number, CachedToken>();

export async function getActiveAppSettings(): Promise<GithubAppSettings | null> {
  return (await getSetting<GithubAppSettings>('github.app')) ?? null;
}

export function signAppJwt(appId: number, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iat: now - 30, // small clock-skew slack
      exp: now + JWT_TTL_SECONDS,
      iss: String(appId),
    },
    privateKeyPem,
    { algorithm: 'RS256' },
  );
}

export async function getInstallationToken(installationId: number): Promise<string> {
  const cached = installationTokens.get(installationId);
  if (cached && cached.expiresAt - Date.now() > TOKEN_REFRESH_BUFFER_MS) {
    return cached.token;
  }
  const app = await getActiveAppSettings();
  if (!app) throw new Error('GitHub App is not configured');

  const appJwt = signAppJwt(app.appId, app.privateKey);
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'AgentBoard',
      },
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`failed to mint installation token (${res.status}): ${body.slice(0, 200)}`);
  }
  const j = (await res.json()) as { token: string; expires_at: string };
  const expiresAt = Date.parse(j.expires_at);
  installationTokens.set(installationId, { token: j.token, expiresAt });
  return j.token;
}

/**
 * Exchange a manifest `code` (returned by GitHub after the user clicks
 * "Create GitHub App" through our manifest form) for the App's secrets.
 */
export async function exchangeAppManifestCode(code: string): Promise<GithubAppSettings> {
  const res = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'AgentBoard',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`manifest exchange failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const j = (await res.json()) as {
    id: number;
    slug: string;
    name: string;
    client_id: string;
    client_secret: string;
    pem: string;
    webhook_secret: string;
    html_url: string;
  };
  const settings: GithubAppSettings = {
    appId: j.id,
    slug: j.slug,
    name: j.name,
    clientId: j.client_id,
    clientSecret: j.client_secret,
    privateKey: j.pem,
    webhookSecret: j.webhook_secret,
    htmlUrl: j.html_url,
  };
  await setSetting<GithubAppSettings>('github.app', settings);
  logger.info({ appId: settings.appId, slug: settings.slug }, 'GitHub App created from manifest');
  return settings;
}

/**
 * Build the JSON manifest GitHub expects when creating an App in one
 * click. The `redirect_url` is where GitHub bounces the operator back
 * with the `code` for the manifest exchange.
 *
 * Permissions are scoped to what the agent team actually needs:
 *   contents:write     → push branches, create commits via API
 *   metadata:read      → repo metadata
 *   pull_requests:write → open + comment on PRs
 *   issues:write       → open + comment on issues
 *   checks:read        → see CI status
 *   workflows:write    → kick off / cancel actions when needed
 */
export interface ManifestInput {
  baseUrl: string; // public URL of the orchestrator (callback host)
  webBaseUrl: string; // public URL of the web app, used as setup_url
  name: string;
  description?: string;
}

export function buildManifest(input: ManifestInput): Record<string, unknown> {
  return {
    name: input.name,
    description:
      input.description ??
      'AgentBoard — multi-agent engineering team built on the Claude Agent SDK.',
    url: input.webBaseUrl,
    public: false,
    redirect_url: `${input.baseUrl}/api/github/app/manifest/callback`,
    callback_urls: [`${input.baseUrl}/api/github/app/installation/callback`],
    setup_url: `${input.webBaseUrl}/settings`,
    setup_on_update: false,
    request_oauth_on_install: false,
    hook_attributes: {
      url: `${input.baseUrl}/api/github/webhook`,
      active: true,
    },
    default_events: [
      'push',
      'pull_request',
      'pull_request_review',
      'pull_request_review_comment',
      'issues',
      'issue_comment',
      'check_run',
      'check_suite',
      'release',
    ],
    default_permissions: {
      contents: 'write',
      metadata: 'read',
      pull_requests: 'write',
      issues: 'write',
      checks: 'read',
      workflows: 'write',
      members: 'read',
    },
  };
}
