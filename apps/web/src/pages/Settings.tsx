import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import * as api from '@/lib/api';
import type { GithubStatus } from '@/lib/types';
import type { NotificationConfig } from '@/lib/api';

export function Settings() {
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      setStatus(await api.githubStatus());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connect failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect GitHub? Projects already connected will keep their local clones.'))
      return;
    setDisconnecting(true);
    try {
      await api.githubDisconnect();
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
                <InfoBlock
                  label="Mode"
                  value={status.mode === 'gh' ? 'gh CLI (host)' : 'Personal Access Token'}
                />
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
                {status.mode === 'pat' ? (
                  <button
                    type="button"
                    className="btn-danger btn-sm"
                    onClick={disconnect}
                    disabled={disconnecting}
                  >
                    {disconnecting ? '…' : 'Disconnect PAT'}
                  </button>
                ) : (
                  <p className="text-[11px] text-fg-3">
                    Using <code className="font-mono">gh</code> — log out with{' '}
                    <code className="font-mono">gh auth logout</code> on the host.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <form onSubmit={connect} className="mt-5 flex flex-col gap-3">
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
                  Needs at least <code className="font-mono">repo</code> scope for private repos and{' '}
                  <code className="font-mono">workflow</code> if PRs touch GitHub Actions.{' '}
                  <a
                    href="https://github.com/settings/personal-access-tokens/new"
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent hover:underline"
                  >
                    Create one on GitHub ↗
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
                  Alternative: run <code className="font-mono">gh auth login</code> on this machine
                  and hit Refresh.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={refresh}
                  >
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
          )}
        </section>

        <NotificationsCard />
      </div>
    </div>
  );
}

/* ──────── Outbound notifications card ──────── */
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
