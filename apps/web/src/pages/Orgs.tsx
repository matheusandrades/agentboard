import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import * as api from '@/lib/api';
import type { GithubStatus, Project } from '@/lib/types';

/**
 * /orgs — surfaces every GitHub account the active connection can reach
 * (the operator's own user + every org / installation), with the count
 * of repos already connected to AgentBoard for each one. Clicking a
 * card filters /projects down to that owner.
 */
export function Orgs() {
  const [accounts, setAccounts] = useState<api.GithubAccount[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [accs, ps, st] = await Promise.all([
        api.githubAccounts(),
        api.listProjects(),
        api.githubStatus(),
      ]);
      setAccounts(accs);
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
    void load();
  }, []);

  const projectsByOwner = useMemo(() => {
    const m = new Map<string, Project[]>();
    for (const p of projects) {
      const arr = m.get(p.repoOwner) ?? [];
      arr.push(p);
      m.set(p.repoOwner, arr);
    }
    return m;
  }, [projects]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        eyebrow="GitHub"
        title="Accounts & organizations"
        subtitle={
          status?.connected ? (
            <span>
              <span className="text-fg tnum">{accounts.length}</span> reachable as{' '}
              <span className="text-fg">{status.login}</span>{' '}
              <span className="text-fg-3">(via {status.mode})</span>
            </span>
          ) : (
            <span className="text-warn">
              Not connected to GitHub. Set it up in{' '}
              <Link to="/settings" className="text-accent hover:underline">
                Settings
              </Link>
              .
            </span>
          )
        }
        actions={
          <button type="button" className="btn-ghost btn-sm" onClick={load}>
            ↻ Refresh
          </button>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        {error ? (
          <div className="mb-3 rounded-lg border border-err/40 bg-err-soft px-3 py-2 text-[12px] text-err">
            {error}
          </div>
        ) : null}

        {loading ? (
          <p className="text-[13px] text-fg-3">Loading…</p>
        ) : accounts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-hairline py-16 text-center">
            <p className="text-[14px] text-fg-3">No accounts visible.</p>
            <p className="mt-2 text-[11px] text-fg-2">
              {status?.connected
                ? "Your token doesn't see any organisations. The default OAuth scope misses some — try the GitHub App."
                : 'Connect GitHub first.'}
            </p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((a) => {
              const connected = projectsByOwner.get(a.login) ?? [];
              return (
                <li key={a.login}>
                  <article className="glass overflow-hidden p-0 transition hover:border-hairline-strong">
                    <header className="flex items-start gap-3 p-4">
                      <img
                        src={a.avatarUrl}
                        alt={a.login}
                        className="h-10 w-10 shrink-0 rounded-md border border-hairline bg-sheen/[0.04]"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <h3 className="truncate text-[14.5px] font-medium text-fg">
                            {a.login}
                          </h3>
                          {a.isUser ? (
                            <span className="pill text-[10px]">you</span>
                          ) : (
                            <span className="pill text-[10px]">org</span>
                          )}
                        </div>
                        {a.name ? (
                          <p className="mt-0.5 truncate text-[12px] text-fg-2">{a.name}</p>
                        ) : null}
                        {a.description ? (
                          <p className="mt-1 line-clamp-2 text-[11.5px] text-fg-3">
                            {a.description}
                          </p>
                        ) : null}
                      </div>
                    </header>
                    <footer className="flex items-center justify-between gap-2 border-t border-hairline px-4 py-2 text-[11px]">
                      <span className="font-mono text-fg-3">
                        <span className="text-fg tnum">{connected.length}</span>{' '}
                        {connected.length === 1 ? 'project' : 'projects'} connected
                      </span>
                      <div className="flex items-center gap-1.5">
                        <a
                          href={a.htmlUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-fg-3 hover:text-fg"
                          title="Open on GitHub"
                        >
                          ↗
                        </a>
                        <Link
                          to={`/projects?owner=${encodeURIComponent(a.login)}`}
                          className="btn-ghost btn-sm"
                        >
                          Browse
                        </Link>
                      </div>
                    </footer>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
