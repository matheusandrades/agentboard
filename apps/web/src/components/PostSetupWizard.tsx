/**
 * Step 2 of the install flow — runs once, right after the operator
 * creates the first admin. Walks them through connecting GitHub
 * (App is recommended; OAuth + PAT remain accessible from /settings).
 *
 * Skipping is fine. The store flag `postSetupPending` is cleared either
 * way, so refreshing the page lands on the dashboard.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import * as api from '@/lib/api';

export function PostSetupWizard() {
  const me = useAuth((s) => s.user);
  const dismiss = useAuth((s) => s.dismissPostSetup);
  const [appCfg, setAppCfg] = useState<api.GithubAppConfig | null>(null);
  const [status, setStatus] = useState<api.AuthUser extends never ? never : Awaited<ReturnType<typeof api.githubStatus>>>();
  const [oauthCfg, setOauthCfg] = useState<api.GithubOauthConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [creatingApp, setCreatingApp] = useState(false);

  async function refresh() {
    try {
      const [s, ac, oc] = await Promise.all([
        api.githubStatus(),
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
        api.githubOauthConfig().catch(
          () =>
            ({
              enabled: false,
              source: null,
              clientIdMasked: null,
              defaultRedirectUrl: '',
            }) satisfies api.GithubOauthConfig,
        ),
      ]);
      setStatus(s);
      setAppCfg(ac);
      setOauthCfg(oc);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  // Refresh when the user returns from a GitHub round-trip in another tab.
  useEffect(() => {
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  async function startOauth() {
    try {
      const { url } = await api.githubOauthStart();
      window.open(url, 'agentboard-github-oauth', 'width=600,height=720');
    } catch {
      /* ignore — user can try again from /settings */
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-6 text-fg">
      <div className="w-full max-w-xl">
        <header className="mb-6 text-center">
          <img src="/brand/logo.png" alt="AgentBoard" className="mx-auto h-12 w-12 select-none" />
          <h1 className="display mt-3 text-[22px] font-semibold tracking-tight text-fg">
            One last thing
          </h1>
          <p className="mt-1 text-[13px] text-fg-2">
            Welcome, <span className="text-fg">{me?.username}</span>. Connect GitHub now and your
            agents can clone repos, push branches, and open PRs straight away. You can skip this and
            wire it later from <span className="text-fg">Settings</span>.
          </p>
        </header>

        {loading ? (
          <p className="text-center text-[12px] text-fg-3">Checking GitHub…</p>
        ) : status?.connected ? (
          <Connected status={status} dismiss={dismiss} />
        ) : (
          <div className="space-y-3">
            {/* GitHub App — recommended */}
            <article className="rounded-2xl border border-accent/40 bg-accent-soft p-5">
              <div className="flex items-start gap-3">
                <Badge label="recommended" tone="ok" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-[15px] font-medium text-fg">GitHub App</h2>
                  <p className="mt-1 text-[12px] text-fg-2">
                    One click, no copy-pasting. Installs on the repos you pick. Webhooks set up
                    automatically.
                  </p>
                </div>
                {appCfg?.configured ? (
                  appCfg.installUrl ? (
                    <a
                      href={appCfg.installUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-sm shrink-0"
                    >
                      Install on a repo ↗
                    </a>
                  ) : null
                ) : (
                  <button
                    type="button"
                    className="btn btn-sm shrink-0"
                    onClick={() => setCreatingApp(true)}
                  >
                    Create GitHub App
                  </button>
                )}
              </div>
            </article>

            {/* OAuth — secondary */}
            <article className="rounded-2xl border border-hairline bg-sheen/[0.02] p-5">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="text-[14px] font-medium text-fg">OAuth App</h2>
                  <p className="mt-1 text-[12px] text-fg-2">
                    User-scoped token (everything you can see). Easier to set up than the App;
                    less granular per-repo control.
                  </p>
                </div>
                {oauthCfg?.enabled ? (
                  <button type="button" className="btn-ghost btn-sm shrink-0" onClick={startOauth}>
                    Connect GitHub
                  </button>
                ) : (
                  <span className="text-[11px] text-fg-3">Set up in /settings</span>
                )}
              </div>
            </article>

            {/* Skip */}
            <div className="pt-2 text-center">
              <button
                type="button"
                className="text-[12px] text-fg-3 hover:text-fg"
                onClick={dismiss}
              >
                Skip — I'll connect GitHub later
              </button>
            </div>
          </div>
        )}

        {creatingApp && me?.role === 'admin' && appCfg ? (
          <CreateAppDialog
            baseUrl={appCfg.baseUrl}
            webBaseUrl={appCfg.webBaseUrl}
            onClose={() => {
              setCreatingApp(false);
              void refresh();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function Connected({
  status,
  dismiss,
}: {
  status: NonNullable<Awaited<ReturnType<typeof api.githubStatus>>>;
  dismiss: () => void;
}) {
  return (
    <div className="rounded-2xl border border-ok/30 bg-ok-soft/40 p-6 text-center">
      <h2 className="text-[15px] font-medium text-fg">GitHub is connected</h2>
      <p className="mt-1 text-[12px] text-fg-2">
        Signed in as <span className="font-mono text-fg">{status.login}</span> via{' '}
        <span className="text-fg">{status.mode}</span>. You're ready to go.
      </p>
      <button type="button" className="btn btn-sm mt-4" onClick={dismiss}>
        Open dashboard →
      </button>
    </div>
  );
}

function Badge({ label, tone }: { label: string; tone: 'ok' | 'warn' }) {
  const cls = tone === 'ok' ? 'pill pill-ok text-[10px]' : 'pill pill-warn text-[10px]';
  return <span className={cls}>{label}</span>;
}

function CreateAppDialog({
  baseUrl,
  webBaseUrl,
  onClose,
}: {
  baseUrl: string;
  webBaseUrl: string;
  onClose: () => void;
}) {
  const defaultName = `agentboard-${(webBaseUrl || baseUrl)
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .slice(0, 30)}`;
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
      setErr(e instanceof Error ? e.message : 'Failed');
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
        <h2 className="text-[16px] font-medium text-fg">Create your GitHub App</h2>
        <p className="mt-1 text-[12px] text-fg-2">
          A new tab opens on GitHub. Click <strong>Create</strong> there and you'll be sent right
          back here with the credentials saved.
        </p>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="eyebrow mb-1 block">App name (must be unique on GitHub)</span>
            <input
              type="text"
              required
              autoComplete="off"
              className="input w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="eyebrow mb-1 block">Organization (optional)</span>
            <input
              type="text"
              autoComplete="off"
              className="input w-full"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              placeholder="leave blank for personal account"
            />
          </label>
        </div>
        {err ? (
          <div className="mt-3 rounded-lg border border-err/40 bg-err-soft px-3 py-2 text-[12px] text-err">
            {err}
          </div>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
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
