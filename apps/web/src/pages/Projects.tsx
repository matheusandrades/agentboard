import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { relativeTime } from '@/lib/time';
import * as api from '@/lib/api';
import type { GithubStatus, Project, RepoSummary } from '@/lib/types';

export function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const ownerFilter = searchParams.get('owner') ?? '';

  async function refresh() {
    try {
      const [ps, st] = await Promise.all([api.listProjects(), api.githubStatus()]);
      setProjects(ps);
      setStatus(st);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onDelete(id: string) {
    if (!confirm('Disconnect this project? The local clone stays on disk.')) return;
    try {
      await api.deleteProject(id);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        eyebrow="Projects"
        title="Connected repos"
        subtitle={
          status?.connected ? (
            <>
              <span className="text-ok tnum">{projects.length}</span> connected · as{' '}
              <span className="text-fg">{status.login}</span>{' '}
              <span className="text-fg-3">(via {status.mode})</span>
            </>
          ) : (
            <span className="text-warn">Not connected to GitHub — set it up in Settings.</span>
          )
        }
        actions={
          <>
            {status?.connected ? (
              <button type="button" className="btn btn-sm" onClick={() => setOpening(true)}>
                ＋ Connect repo
              </button>
            ) : (
              <Link to="/settings" className="btn btn-sm">
                Open Settings
              </Link>
            )}
            <button type="button" className="btn-ghost btn-sm" onClick={refresh}>
              ↻
            </button>
          </>
        }
      />

      {error ? (
        <div className="border-b border-err/40 bg-err-soft px-6 py-2 text-[12px] text-err">
          {error}
        </div>
      ) : null}

      {ownerFilter ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-hairline bg-canvas-sunken/30 px-6 py-2 text-[12px] text-fg-2">
          <span className="text-fg-3">Filtered by</span>
          <span className="pill text-[10px]">{ownerFilter}</span>
          <button
            type="button"
            className="text-fg-3 hover:text-fg"
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete('owner');
              setSearchParams(next, { replace: true });
            }}
          >
            ✕ clear
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        {loading ? (
          <p className="text-[13px] text-fg-3">Loading…</p>
        ) : projects.filter((p) => !ownerFilter || p.repoOwner === ownerFilter).length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-hairline py-24 text-center">
            <span className="text-[15px] text-fg-3">No projects connected</span>
            <p className="mt-2 max-w-md text-[11px] text-fg-2">
              Connect a GitHub repository so agents can clone it, create task branches, commit, and
              open pull requests instead of working in throwaway worktrees.
            </p>
            {status?.connected ? (
              <button
                type="button"
                className="btn btn-sm mt-4"
                onClick={() => setOpening(true)}
              >
                ＋ Connect your first repo
              </button>
            ) : null}
          </div>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {projects
              .filter((p) => !ownerFilter || p.repoOwner === ownerFilter)
              .map((p) => (
                <li key={p.id}>
                  <ProjectCard project={p} onDelete={() => onDelete(p.id)} />
                </li>
              ))}
          </ul>
        )}
      </div>

      {opening ? (
        <ConnectRepoDialog
          onClose={() => setOpening(false)}
          onConnected={refresh}
          query={query}
          setQuery={setQuery}
        />
      ) : null}
    </div>
  );
}

/* ───────────────────── Connect repo sheet ──────────────────────── */
/* ──────────────────── Project card with stats ──────────────────── */
function ProjectCard({
  project: p,
  onDelete,
}: {
  project: Project;
  onDelete: () => void;
}) {
  const stats = p.stats;
  return (
    <article className="glass group overflow-hidden p-0 transition hover:border-hairline-strong">
      <Link to={`/projects/${p.id}`} className="block p-5">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={[
                  'pill text-[10px]',
                  p.visibility === 'public' ? 'pill-ok' : '',
                ].join(' ')}
              >
                {p.visibility}
              </span>
              <span className="pill text-[10px] tnum">{p.defaultBranch}</span>
            </div>
            <h3 className="mt-1.5 truncate text-[16px] font-medium tracking-tight text-fg">
              {p.name}
            </h3>
            <p className="mt-0.5 font-mono text-[11px] text-fg-3">
              {p.repoOwner}/{p.repoName}
            </p>
            {p.description ? (
              <p className="mt-2 line-clamp-2 text-[12px] text-fg-2">{p.description}</p>
            ) : null}
          </div>
        </header>

        {/* Stats strip */}
        {stats ? (
          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-hairline pt-3">
            <Stat
              label="In flight"
              value={stats.tasksOpen}
              total={stats.tasksTotal}
              tone="accent"
            />
            <Stat label="In review" value={stats.tasksReview} tone="warn" />
            <Stat label="Commits 7d" value={stats.commits7d} />
          </div>
        ) : null}

        <footer className="mt-3 flex items-center justify-between text-[11px] text-fg-3">
          <span>
            {stats?.lastCommitAt
              ? `last commit ${relativeTime(stats.lastCommitAt)}`
              : `connected ${relativeTime(p.createdAt)}`}
          </span>
          <span className="text-accent opacity-0 transition group-hover:opacity-100">Open →</span>
        </footer>
      </Link>
      <div className="flex items-center gap-2 border-t border-hairline px-4 py-2">
        <a
          href={`https://github.com/${p.repoOwner}/${p.repoName}`}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-fg-3 hover:text-fg hover:underline"
        >
          GitHub ↗
        </a>
        <button
          type="button"
          className="btn-ghost btn-sm ml-auto"
          onClick={onDelete}
          title="Disconnect project"
        >
          Disconnect
        </button>
      </div>
    </article>
  );
}

function Stat({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total?: number;
  tone?: 'accent' | 'warn';
}) {
  const color =
    tone === 'accent'
      ? value > 0
        ? 'text-accent'
        : 'text-fg-3'
      : tone === 'warn'
        ? value > 0
          ? 'text-warn'
          : 'text-fg-3'
        : value > 0
          ? 'text-fg'
          : 'text-fg-3';
  return (
    <div className="rounded-md border border-hairline bg-sheen/[0.02] px-2 py-1.5">
      <span className="block text-[10px] uppercase tracking-wider text-fg-3">{label}</span>
      <span className={['mt-0.5 block font-mono text-[15px] tnum', color].join(' ')}>
        {value}
        {typeof total === 'number' && total !== value ? (
          <span className="ml-0.5 text-[10px] text-fg-3">/{total}</span>
        ) : null}
      </span>
    </div>
  );
}

function ConnectRepoDialog({
  onClose,
  onConnected,
  query,
  setQuery,
}: {
  onClose: () => void;
  onConnected: () => void | Promise<void>;
  query: string;
  setQuery: (s: string) => void;
}) {
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [accounts, setAccounts] = useState<api.GithubAccount[]>([]);
  const [owner, setOwner] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [rs, accs] = await Promise.all([
          api.githubRepos({ limit: 200 }),
          api.githubAccounts().catch(() => [] as api.GithubAccount[]),
        ]);
        setRepos(rs);
        setAccounts(accs);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to list repos');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let xs = repos;
    if (owner) xs = xs.filter((r) => r.owner === owner);
    if (q) {
      xs = xs.filter(
        (r) =>
          r.fullName.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q),
      );
    }
    return xs;
  }, [repos, query, owner]);

  async function connect(r: RepoSummary) {
    if (connecting) return;
    setConnecting(r.fullName);
    setError(null);
    try {
      await api.createProject({
        owner: r.owner,
        repo: r.name,
        name: r.name,
        defaultBranch: r.defaultBranch,
        description: r.description ?? undefined,
        visibility: r.visibility,
      });
      await onConnected();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connect failed');
    } finally {
      setConnecting(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex w-full max-w-2xl flex-col border-l border-hairline bg-canvas-raised shadow-glass-lg animate-sheet-in"
        role="dialog"
        aria-modal="true"
      >
        <header className="shrink-0 border-b border-hairline px-6 py-5">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-5 top-5 btn-icon"
            aria-label="Close"
          >
            ✕
          </button>
          <span className="eyebrow">Connect a GitHub repo</span>
          <h2 className="mt-2 text-[20px] font-medium tracking-tight text-fg">Pick a repo</h2>
          <p className="mt-1 text-[12px] text-fg-2">
            Agents will clone it into <code className="font-mono">workspace/projects/</code> and
            commit to per-task branches. The clone is kept on disk until you disconnect.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <input
              className="input flex-1"
              placeholder="Filter by name, description…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            {accounts.length > 1 ? (
              <select
                className="input w-44"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                title="Filter by owner / org"
              >
                <option value="">All accounts</option>
                {accounts.map((a) => (
                  <option key={a.login} value={a.login}>
                    {a.login}
                    {a.isUser ? ' (you)' : ''}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <div className="border-b border-err/40 bg-err-soft px-6 py-2 text-[12px] text-err">
              {error}
            </div>
          ) : null}
          {loading ? (
            <p className="p-6 text-[13px] text-fg-3">Loading your repos…</p>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-[13px] text-fg-3">No repos match.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {filtered.map((r) => (
                <li
                  key={r.fullName}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-sheen/[0.02]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-fg">{r.fullName}</span>
                      <span
                        className={[
                          'pill text-[10px]',
                          r.visibility === 'public' ? 'pill-ok' : 'pill',
                        ].join(' ')}
                      >
                        {r.visibility}
                      </span>
                      <span className="pill text-[10px]">{r.defaultBranch}</span>
                    </div>
                    {r.description ? (
                      <p className="mt-0.5 line-clamp-1 text-[11px] text-fg-2">{r.description}</p>
                    ) : null}
                    <div className="mt-0.5 text-[10px] text-fg-3">
                      {r.pushedAt ? `pushed ${relativeTime(r.pushedAt)}` : '—'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={connecting !== null}
                    onClick={() => connect(r)}
                  >
                    {connecting === r.fullName ? 'Connecting…' : 'Connect'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
