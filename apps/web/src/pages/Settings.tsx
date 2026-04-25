import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/lib/auth';
import * as api from '@/lib/api';
import type { GithubStatus } from '@/lib/types';
import type { NotificationConfig } from '@/lib/api';

export function Settings() {
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [oauthCfg, setOauthCfg] = useState<api.GithubOauthConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [showPat, setShowPat] = useState(false);
  const [showOauthSetup, setShowOauthSetup] = useState(false);
  const [appCfg, setAppCfg] = useState<api.GithubAppConfig | null>(null);
  const [showAppCreate, setShowAppCreate] = useState(false);
  const me = useAuth((s) => s.user);

  async function refresh() {
    setLoading(true);
    try {
      const [s, c, ac] = await Promise.all([
        api.githubStatus(),
        api.githubOauthConfig().catch(
          () =>
            ({
              enabled: false,
              source: null,
              clientIdMasked: null,
              defaultRedirectUrl: '',
            }) satisfies api.GithubOauthConfig,
        ),
        api.githubAppConfig().catch(
          () =>
            ({
              configured: false,
              slug: null,
              htmlUrl: null,
              installUrl: null,
              manifestEndpoint: null,
              baseUrl: '',
              webBaseUrl: '',
            }) satisfies api.GithubAppConfig,
        ),
      ]);
      setStatus(s);
      setOauthCfg(c);
      setAppCfg(ac);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  // Listen for the popup's postMessage so we refresh status the moment
  // the user finishes the GitHub round-trip.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const data = e.data as { type?: string; success?: boolean } | null;
      if (data?.type === 'agentboard:oauth') {
        setOauthBusy(false);
        if (data.success) void refresh();
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // Re-pull GitHub status when the user comes back to this tab. They
  // might have just registered an App or finished an installation in
  // another tab; we want the UI to reflect that without a manual
  // refresh.
  useEffect(() => {
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const s = await api.githubConnect(token.trim());
      setStatus(s);
      setToken('');
      setShowPat(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connect failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function startOauth() {
    if (oauthBusy) return;
    setOauthBusy(true);
    setError(null);
    try {
      const { url } = await api.githubOauthStart();
      // 600x720 centred popup like Vercel/Linear.
      const w = 600;
      const h = 720;
      const left = window.screenX + Math.max(0, (window.outerWidth - w) / 2);
      const top = window.screenY + Math.max(0, (window.outerHeight - h) / 2);
      const popup = window.open(
        url,
        'agentboard-github-oauth',
        `width=${w},height=${h},left=${left},top=${top}`,
      );
      if (!popup) {
        // Popup blocked — full redirect fallback.
        window.location.href = url;
        return;
      }
      // Best-effort: detect popup close to clear busy state.
      const interval = setInterval(() => {
        if (popup.closed) {
          clearInterval(interval);
          setOauthBusy(false);
          void refresh();
        }
      }, 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start OAuth');
      setOauthBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect GitHub? Projects already connected will keep their local clones.'))
      return;
    setDisconnecting(true);
    try {
      if (status?.mode === 'oauth') {
        await api.githubOauthDisconnect();
      } else {
        await api.githubDisconnect();
      }
      await refresh();
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        eyebrow="Settings"
        title="Integrations"
        subtitle="Connect external systems so agents can pull code, open PRs, and deploy."
      />

      <div className="min-h-0 flex-1 overflow-auto px-6 py-6 space-y-6">
        <section className="glass max-w-3xl p-6">
          <header className="flex items-start gap-3">
            <GitHubMark />
            <div className="min-w-0 flex-1">
              <h3 className="text-[16px] font-medium tracking-tight text-fg">GitHub</h3>
              <p className="mt-1 text-[12px] text-fg-2">
                Lets agents clone repos, push branches, and open PRs under your identity. You can
                either authenticate with the local <code className="font-mono">gh</code> CLI
                (enterprise-friendly — supports SSO and GitHub Apps) or paste a fine-grained
                Personal Access Token.
              </p>
            </div>
            {loading ? null : status?.connected ? (
              <span className="pill pill-ok">connected</span>
            ) : (
              <span className="pill pill-warn">not connected</span>
            )}
          </header>

          {loading ? (
            <p className="mt-6 text-[12px] text-fg-3">Checking…</p>
          ) : status?.connected ? (
            <div className="mt-5 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <InfoBlock label="Signed in as" value={status.login ?? '—'} />
                <InfoBlock label="Mode" value={modeLabel(status.mode)} />
                <InfoBlock
                  label="Scopes"
                  value={status.scopes && status.scopes.length ? status.scopes.join(', ') : '—'}
                />
                <InfoBlock label="Detail" value={status.detail ?? ''} dim />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <Link to="/projects" className="btn btn-sm">
                  Connect a repo →
                </Link>
                {status.mode === 'gh' ? (
                  <p className="text-[11px] text-fg-3">
                    Using <code className="font-mono">gh</code> — log out with{' '}
                    <code className="font-mono">gh auth logout</code> on the host.
                  </p>
                ) : (
                  <button
                    type="button"
                    className="btn-danger btn-sm"
                    onClick={disconnect}
                    disabled={disconnecting}
                  >
                    {disconnecting
                      ? '…'
                      : status.mode === 'oauth'
                        ? 'Disconnect OAuth'
                        : 'Disconnect PAT'}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-5 space-y-5">
              {/* Recommended path: GitHub App */}
              {appCfg ? (
                <GithubAppSection
                  cfg={appCfg}
                  isAdmin={me?.role === 'admin'}
                  onCreate={() => setShowAppCreate(true)}
                  onForget={async () => {
                    if (!confirm('Forget the saved GitHub App? You will need to recreate it.'))
                      return;
                    await api.githubAppForget();
                    await refresh();
                  }}
                />
              ) : null}

              {oauthCfg?.enabled ? (
                <div className="rounded-xl border border-hairline bg-sheen/[0.03] p-4">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-fg">Connect with GitHub</p>
                      <p className="mt-1 text-[11.5px] text-fg-2">
                        Opens a GitHub authorisation window. Recommended — single click, scoped
                        token, easy to revoke.
                        {oauthCfg.clientIdMasked ? (
                          <>
                            {' '}
                            <span className="font-mono text-fg-3">
                              app: {oauthCfg.clientIdMasked} (
                              {oauthCfg.source === 'env' ? 'from .env' : 'from settings'})
                            </span>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={startOauth}
                        disabled={oauthBusy}
                      >
                        {oauthBusy ? 'Waiting for GitHub…' : 'Connect GitHub'}
                      </button>
                      {me?.role === 'admin' && oauthCfg.source === 'db' ? (
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          onClick={() => setShowOauthSetup(true)}
                          title="Edit OAuth credentials"
                        >
                          Edit app
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : me?.role === 'admin' ? (
                <div className="rounded-xl border border-hairline bg-sheen/[0.02] p-4">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-fg">Set up GitHub OAuth</p>
                      <p className="mt-1 text-[11.5px] text-fg-2">
                        Create an OAuth App once and AgentBoard handles the rest. No env editing
                        needed.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm shrink-0"
                      onClick={() => setShowOauthSetup(true)}
                    >
                      Set up
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-hairline bg-sheen/[0.02] p-4">
                  <p className="text-[13px] font-medium text-fg">GitHub OAuth not configured</p>
                  <p className="mt-1 text-[11.5px] text-fg-2">
                    Ask an administrator to add the GitHub OAuth credentials in Settings.
                  </p>
                </div>
              )}

              <div>
                <button
                  type="button"
                  onClick={() => setShowPat((s) => !s)}
                  className="text-[12px] text-fg-3 hover:text-fg"
                >
                  {showPat ? '−' : '+'} Advanced — use a Personal Access Token instead
                </button>
              </div>

              {showPat ? (
                <form onSubmit={connect} className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="eyebrow">Personal Access Token</span>
                    <input
                      className="input"
                      type="password"
                      placeholder="github_pat_..."
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      autoComplete="off"
                    />
                    <span className="text-[11px] text-fg-3">
                      Needs at least <code className="font-mono">repo</code> scope for private
                      repos and <code className="font-mono">workflow</code> if PRs touch GitHub
                      Actions.{' '}
                      <a
                        href="https://github.com/settings/personal-access-tokens/new"
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent hover:underline"
                      >
                        Create one ↗
                      </a>
                    </span>
                  </label>
                  {error ? (
                    <div className="rounded-lg border border-err/40 bg-err-soft px-3 py-2 text-[12px] text-err">
                      {error}
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] text-fg-3">
                      Or run <code className="font-mono">gh auth login</code> on this machine and hit
                      Refresh.
                    </p>
                    <div className="flex items-center gap-2">
                      <button type="button" className="btn-ghost btn-sm" onClick={refresh}>
                        Refresh
                      </button>
                      <button
                        type="submit"
                        className="btn btn-sm"
                        disabled={submitting || !token.trim()}
                      >
                        {submitting ? 'Verifying…' : 'Connect'}
                      </button>
                    </div>
                  </div>
                </form>
              ) : null}
            </div>
          )}
        </section>

        <NotificationsCard />
      </div>

      {showOauthSetup && me?.role === 'admin' ? (
        <OauthSetupDialog
          defaultRedirectUrl={oauthCfg?.defaultRedirectUrl ?? ''}
          source={oauthCfg?.source ?? null}
          onClose={() => setShowOauthSetup(false)}
          onSaved={() => {
            setShowOauthSetup(false);
            void refresh();
          }}
        />
      ) : null}

      {showAppCreate && me?.role === 'admin' ? (
        <CreateGithubAppDialog
          baseUrl={appCfg?.baseUrl ?? ''}
          webBaseUrl={appCfg?.webBaseUrl ?? ''}
          onClose={() => {
            setShowAppCreate(false);
            // The user is now on GitHub in a new tab. We refresh on
            // window focus so when they come back the App row appears.
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/* ──────── GitHub OAuth setup (admin) ──────── */
function OauthSetupDialog({
  defaultRedirectUrl,
  source,
  onClose,
  onSaved,
}: {
  defaultRedirectUrl: string;
  source: 'db' | 'env' | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [redirect, setRedirect] = useState(defaultRedirectUrl);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const ok = clientId.trim().length >= 8 && clientSecret.trim().length >= 8;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api.saveGithubOauthCreds({
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        redirectUrl: redirect.trim() || undefined,
      });
      onSaved();
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 403) setErr('Only administrators can change OAuth credentials.');
      else setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (!confirm('Remove the stored OAuth credentials? Existing connections stay.')) return;
    setBusy(true);
    try {
      await api.clearGithubOauthCreds();
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Clear failed');
    } finally {
      setBusy(false);
    }
  }

  async function copyCallback() {
    try {
      await navigator.clipboard.writeText(redirect);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-hairline bg-canvas-raised p-6"
      >
        <h2 className="text-[16px] font-medium text-fg">Set up GitHub OAuth</h2>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-[12px] text-fg-2">
          <li>
            Open{' '}
            <a
              className="text-accent hover:underline"
              href="https://github.com/settings/applications/new"
              target="_blank"
              rel="noreferrer"
            >
              github.com/settings/applications/new
            </a>{' '}
            and create an OAuth App.
          </li>
          <li>
            Set the <span className="font-medium text-fg">Authorization callback URL</span> to the
            value below.
          </li>
          <li>Copy the Client ID and Client Secret here, then save.</li>
        </ol>

        <div className="mt-4 rounded-lg border border-hairline bg-sheen/[0.04] p-3">
          <div className="flex items-center gap-2">
            <span className="eyebrow">Authorization callback URL</span>
            <button
              type="button"
              className="ml-auto btn-ghost btn-sm"
              onClick={copyCallback}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <input
            type="url"
            className="input mt-2 w-full font-mono text-[12px]"
            value={redirect}
            onChange={(e) => setRedirect(e.target.value)}
          />
          <p className="mt-1 text-[10.5px] text-fg-3">
            Defaults to this orchestrator. Change only if AgentBoard runs behind a proxy.
          </p>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="eyebrow mb-1 block">Client ID</span>
            <input
              type="text"
              required
              autoComplete="off"
              className="input w-full font-mono text-[12px]"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Iv1.xxxxxxxxxxxx"
            />
          </label>
          <label className="block">
            <span className="eyebrow mb-1 block">Client Secret</span>
            <input
              type="password"
              required
              autoComplete="off"
              className="input w-full font-mono text-[12px]"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
            />
          </label>
        </div>

        {err ? (
          <div className="mt-3 rounded-lg border border-err/40 bg-err-soft px-3 py-2 text-[12px] text-err">
            {err}
          </div>
        ) : null}

        <div className="mt-5 flex items-center justify-between gap-2">
          <div>
            {source === 'db' ? (
              <button
                type="button"
                className="btn-danger btn-sm"
                onClick={clear}
                disabled={busy}
              >
                Remove credentials
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost btn-sm" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-sm" disabled={!ok || busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

/* ──────── Outbound notifications card ──────── */
/* ──────── GitHub App section + create dialog ──────── */
function GithubAppSection({
  cfg,
  isAdmin,
  onCreate,
  onForget,
}: {
  cfg: api.GithubAppConfig;
  isAdmin: boolean;
  onCreate: () => void;
  onForget: () => void;
}) {
  if (cfg.configured) {
    return (
      <div className="rounded-xl border border-accent/40 bg-accent-soft p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-[13px] font-medium text-fg">GitHub App ready</p>
              <span className="pill pill-ok text-[10px]">recommended</span>
            </div>
            <p className="mt-1 text-[11.5px] text-fg-2">
              The App <span className="font-mono text-fg">{cfg.slug}</span> is registered. Install
              it on the orgs / repos you want agents to operate on.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {cfg.installUrl ? (
              <a
                className="btn btn-sm"
                href={cfg.installUrl}
                target="_blank"
                rel="noreferrer"
              >
                Install on a repo ↗
              </a>
            ) : null}
            {cfg.htmlUrl ? (
              <a
                className="btn-ghost btn-sm"
                href={cfg.htmlUrl}
                target="_blank"
                rel="noreferrer"
              >
                Manage on GitHub ↗
              </a>
            ) : null}
            {isAdmin ? (
              <button type="button" className="btn-ghost btn-sm" onClick={onForget}>
                Forget
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="rounded-xl border border-hairline bg-sheen/[0.02] p-4">
        <p className="text-[13px] font-medium text-fg">GitHub App (recommended)</p>
        <p className="mt-1 text-[11.5px] text-fg-2">
          Ask an administrator to set up a GitHub App. It gives the agents fine-grained per-repo
          access without anyone pasting a personal token.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-accent/40 bg-accent-soft p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-[13px] font-medium text-fg">Set up GitHub App</p>
            <span className="pill pill-ok text-[10px]">recommended</span>
          </div>
          <p className="mt-1 text-[11.5px] text-fg-2">
            One click sends you to GitHub with a pre-filled manifest — no copy-pasting client ids,
            secrets, webhook URLs, or permissions. After that, install it on whichever repos you
            want.
          </p>
        </div>
        <button type="button" className="btn btn-sm shrink-0" onClick={onCreate}>
          Create GitHub App
        </button>
      </div>
    </div>
  );
}

function CreateGithubAppDialog({
  baseUrl,
  webBaseUrl,
  onClose,
}: {
  baseUrl: string;
  webBaseUrl: string;
  onClose: () => void;
}) {
  const defaultName = `agentboard-${(webBaseUrl || baseUrl).replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').slice(0, 30)}`;
  const [name, setName] = useState(defaultName);
  const [organization, setOrganization] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const { manifest, action } = await api.githubAppPrepareManifest({
        name: name.trim(),
        organization: organization.trim() || undefined,
      });
      // POST a hidden form to GitHub. We can't fetch() it because the
      // manifest endpoint must be reached through a real form submission
      // that opens a confirmation page in a new tab.
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = action;
      form.target = '_blank';
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'manifest';
      input.value = manifest;
      form.appendChild(input);
      document.body.appendChild(form);
      form.submit();
      document.body.removeChild(form);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to prepare manifest');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-hairline bg-canvas-raised p-6"
      >
        <h2 className="text-[16px] font-medium text-fg">Create GitHub App</h2>
        <p className="mt-1 text-[12px] text-fg-2">
          A new tab will open on GitHub showing a confirmation page. Click <strong>Create</strong>{' '}
          there and you'll be sent right back here.
        </p>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="eyebrow mb-1 block">App name</span>
            <input
              type="text"
              required
              autoComplete="off"
              className="input w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-fg-3">
              Must be unique on GitHub. We'll prefix yours with{' '}
              <code className="font-mono">agentboard-</code> by default.
            </p>
          </label>
          <label className="block">
            <span className="eyebrow mb-1 block">Organization (optional)</span>
            <input
              type="text"
              autoComplete="off"
              className="input w-full"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              placeholder="leave blank to install under your personal account"
            />
          </label>
        </div>
        {err ? (
          <div className="mt-3 rounded-lg border border-err/40 bg-err-soft px-3 py-2 text-[12px] text-err">
            {err}
          </div>
        ) : null}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-sm" disabled={busy || !name.trim()}>
            {busy ? 'Preparing…' : 'Continue on GitHub →'}
          </button>
        </div>
      </form>
    </div>
  );
}

function NotificationsCard() {
  const [items, setItems] = useState<NotificationConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [template, setTemplate] = useState<'slack' | 'generic'>('slack');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setItems(await api.listNotifications());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.createNotification({ label, targetUrl: url, template });
      setLabel('');
      setUrl('');
      setOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="glass max-w-3xl p-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[16px] font-medium tracking-tight text-fg">Notifications</h3>
          <p className="mt-1 text-[12px] text-fg-2">
            Webhooks fired on every relevant team event. Slack, Discord, and Teams accept the
            default <code className="font-mono">{`{ text }`}</code> payload as-is. Pick "Generic" if your tool needs the raw event.
          </p>
        </div>
        {!open ? (
          <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
            ＋ Add webhook
          </button>
        ) : null}
      </header>

      {open ? (
        <form onSubmit={add} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 sm:col-span-1">
            <span className="eyebrow">Label</span>
            <input
              className="input"
              placeholder="Team Slack — #engineering"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1.5 sm:col-span-1">
            <span className="eyebrow">Template</span>
            <select className="input" value={template} onChange={(e) => setTemplate(e.target.value as 'slack' | 'generic')}>
              <option value="slack">Slack / Discord / Teams (text)</option>
              <option value="generic">Generic (raw event JSON)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="eyebrow">Webhook URL</span>
            <input
              className="input"
              placeholder="https://hooks.slack.com/services/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          {error ? (
            <div className="sm:col-span-2 rounded-lg border border-err/40 bg-err-soft px-3 py-2 text-[12px] text-err">
              {error}
            </div>
          ) : null}
          <div className="flex items-center justify-end gap-2 sm:col-span-2">
            <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-sm" disabled={busy || !label || !url}>
              {busy ? 'Saving…' : 'Save webhook'}
            </button>
          </div>
        </form>
      ) : null}

      <div className="mt-4">
        {loading ? (
          <p className="text-[12px] text-fg-3">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-[12px] text-fg-3">No webhooks yet.</p>
        ) : (
          <ul className="divide-y divide-hairline rounded-xl border border-hairline bg-sheen/[0.02]">
            {items.map((n) => (
              <li key={n.id} className="flex items-center gap-3 px-3 py-2">
                <span
                  className={[
                    'h-1.5 w-1.5 rounded-full',
                    n.enabled ? 'bg-ok' : 'bg-fg-3',
                  ].join(' ')}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] text-fg">{n.label}</p>
                  <p className="truncate font-mono text-[10px] text-fg-3">{n.targetUrl}</p>
                </div>
                <span className="pill text-[10px]">{n.template}</span>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => api.testNotification(n.id).then(() => alert('Sent.')).catch((err) => alert(String(err)))}
                >
                  Test
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={async () => {
                    if (confirm(`Delete webhook "${n.label}"?`)) {
                      await api.deleteNotification(n.id);
                      void load();
                    }
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function modeLabel(mode: GithubStatus['mode']): string {
  switch (mode) {
    case 'gh':
      return 'gh CLI (host)';
    case 'pat':
      return 'Personal Access Token';
    case 'oauth':
      return 'OAuth App';
    case 'app':
      return 'GitHub App';
    default:
      return '—';
  }
}

function InfoBlock({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  if (!value) return null;
  return (
    <div className="rounded-lg border border-hairline bg-sheen/[0.02] px-3 py-2">
      <span className="eyebrow block">{label}</span>
      <span className={['mt-1 block truncate text-[13px]', dim ? 'text-fg-3' : 'text-fg'].join(' ')}>
        {value}
      </span>
    </div>
  );
}

function GitHubMark() {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sheen/[0.08]">
      <svg viewBox="0 0 16 16" fill="currentColor" className="h-5 w-5 text-fg">
        <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 005.47 7.59c.4.074.546-.174.546-.387 0-.19-.007-.693-.011-1.36-2.225.483-2.695-1.073-2.695-1.073-.364-.924-.889-1.17-.889-1.17-.727-.497.055-.487.055-.487.803.056 1.226.825 1.226.825.714 1.223 1.873.87 2.33.665.072-.517.28-.87.508-1.07-1.777-.2-3.644-.888-3.644-3.954 0-.873.312-1.587.824-2.147-.082-.202-.357-1.016.079-2.117 0 0 .672-.215 2.2.82A7.65 7.65 0 018 4.26c.68.003 1.364.092 2.003.27 1.527-1.035 2.198-.82 2.198-.82.437 1.1.162 1.915.08 2.117.513.56.823 1.274.823 2.147 0 3.073-1.87 3.752-3.653 3.948.287.248.543.738.543 1.488 0 1.074-.01 1.94-.01 2.205 0 .215.144.465.55.386A8 8 0 0016 8c0-4.42-3.58-8-8-8z" />
      </svg>
    </span>
  );
}
