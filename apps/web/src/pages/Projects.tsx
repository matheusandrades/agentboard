import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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

      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        {loading ? (
          <p className="text-[13px] text-fg-3">Loading…</p>
        ) : projects.length === 0 ? (
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
          <ul className="grid gap-3 lg:grid-cols-2">
            {projects.map((p) => (
              <li key={p.id}>
                <article className="glass overflow-hidden p-0 hover-raise">
                  <Link to={`/projects/${p.id}`} className="block p-5">
                    <header className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="eyebrow">{p.visibility}</span>
                          <span className="pill tnum">{p.defaultBranch}</span>
                        </div>
                        <h3 className="mt-1 truncate text-[16px] font-medium tracking-tight text-fg">
                          {p.name}
                        </h3>
                        <p className="mt-0.5 font-mono text-[11px] text-fg-2">
                          {p.repoOwner}/{p.repoName}
                        </p>
                        {p.description ? (
                          <p className="mt-2 line-clamp-2 text-[12.5px] text-fg-2">
                            {p.description}
                          </p>
                        ) : null}
                      </div>
                    </header>
                    <footer className="mt-4 flex items-center justify-between border-t border-hairline pt-3 text-[11px] text-fg-3">
                      <span>Connected {relativeTime(p.createdAt)}</span>
                      <span className="text-accent">Open ↗</span>
                    </footer>
                  </Link>
                  <div className="flex items-center gap-2 border-t border-hairline px-4 py-2">
                    <a
                      href={`https://github.com/${p.repoOwner}/${p.repoName}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-fg-2 hover:text-fg hover:underline"
                    >
                      GitHub ↗
                    </a>
                    <button
                      type="button"
                      className="btn-ghost btn-sm ml-auto"
                      onClick={() => onDelete(p.id)}
                      title="Disconnect project"
                    >
                      Disconnect
                    </button>
                  </div>
                </article>
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
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const rs = await api.githubRepos(200);
        setRepos(rs);
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
    if (!q) return repos;
    return repos.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q),
    );
  }, [repos, query]);

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
              className="input"
              placeholder="Filter by owner, name, description…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
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
