import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBoardStore } from '@/lib/store';
import { AgentAvatar } from '@/components/AgentAvatar';
import { PageHeader } from '@/components/PageHeader';
import { relativeTime } from '@/lib/time';
import * as api from '@/lib/api';
import type { Commit } from '@/lib/types';

type CommitDetail = Commit & { diff: string; stats: string };

export function Commits() {
  const commits = useBoardStore((s) => s.commits);
  const agents = useBoardStore((s) => s.agents);
  const tasks = useBoardStore((s) => s.tasks);
  const [search] = useSearchParams();
  const focus = search.get('focus');
  const [selectedId, setSelectedId] = useState<string | null>(focus);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | string>('all');
  const [query, setQuery] = useState('');

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    let xs = filter === 'all' ? commits.slice() : commits.filter((c) => c.agentId === filter);
    if (q)
      xs = xs.filter(
        (c) =>
          (c.message ?? '').toLowerCase().includes(q) ||
          c.sha.toLowerCase().includes(q) ||
          (c.branch ?? '').toLowerCase().includes(q),
      );
    return xs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [commits, filter, query]);

  // Group by day (Today / Yesterday / formatted date) for visual rhythm.
  const grouped = useMemo(() => groupByDay(list), [list]);

  useEffect(() => {
    if (!selectedId && list[0]) setSelectedId(list[0].id);
  }, [list, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancel = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const d = await api.getCommit(selectedId);
        if (!cancel) setDetail(d);
      } catch (err) {
        if (!cancel) setError(err instanceof Error ? err.message : 'Failed to load diff');
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [selectedId]);

  const agentCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of commits) {
      if (!c.agentId) continue;
      m.set(c.agentId, (m.get(c.agentId) ?? 0) + 1);
    }
    return m;
  }, [commits]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        eyebrow="Commits"
        title="What the team shipped"
        subtitle={
          <>
            <span className="text-fg tnum">{list.length}</span> of{' '}
            <span className="text-fg tnum">{commits.length}</span>
            {filter !== 'all' || query ? ' · filtered' : ''}
          </>
        }
        actions={
          <>
            <input
              type="search"
              placeholder="Search SHA / message / branch…"
              className="input py-1 text-[12px]"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ minWidth: 220 }}
            />
            <span className="mx-1 h-5 w-px bg-hairline" />
            <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
              All · {commits.length}
            </FilterChip>
            {agents.map((a) => {
              const n = agentCounts.get(a.id) ?? 0;
              if (n === 0) return null;
              return (
                <FilterChip
                  key={a.id}
                  active={filter === a.id}
                  onClick={() => setFilter(a.id)}
                  title={a.name}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <AgentAvatar agent={a} size="sm" />
                    <span className="tnum text-[10px]">{n}</span>
                  </span>
                </FilterChip>
              );
            })}
          </>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[360px_1fr]">
        {/* Sidebar list */}
        <aside className="flex min-h-0 flex-col overflow-hidden border-r border-hairline">
          <div className="min-h-0 flex-1 overflow-auto">
            {list.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <p className="text-[13px] text-fg-3">No commits match.</p>
                <p className="mt-1 text-[11px] text-fg-2">
                  When agents push work, it shows up here automatically.
                </p>
              </div>
            ) : (
              grouped.map((g) => (
                <div key={g.label}>
                  <div className="sticky top-0 z-10 border-y border-hairline bg-canvas/95 px-4 py-1.5 backdrop-blur">
                    <span className="eyebrow">{g.label}</span>
                    <span className="ml-2 text-[10px] text-fg-3 tnum">{g.commits.length}</span>
                  </div>
                  <ul>
                    {g.commits.map((c) => {
                      const agent = c.agentId ? agentById.get(c.agentId) : null;
                      const task = c.taskId ? taskById.get(c.taskId) : null;
                      const active = c.id === selectedId;
                      return (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedId(c.id)}
                            className={[
                              'flex w-full items-start gap-3 border-b border-hairline px-4 py-2.5 text-left transition',
                              active
                                ? 'bg-violet-soft'
                                : 'hover:bg-sheen/[0.03]',
                            ].join(' ')}
                          >
                            {agent ? (
                              <AgentAvatar agent={agent} size="sm" />
                            ) : (
                              <span className="inline-block h-6 w-6 rounded-full bg-sheen/[0.08]" />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="line-clamp-2 text-[12.5px] leading-snug text-fg">
                                {c.message ?? '(no message)'}
                              </p>
                              <div className="mt-1 flex items-center gap-2 text-[10px] text-fg-3 font-mono">
                                <span className="text-violet-bright tnum">
                                  {c.sha.slice(0, 7)}
                                </span>
                                {agent ? <span>·</span> : null}
                                {agent ? <span>{agent.name}</span> : null}
                                <span>·</span>
                                <span>{shortTime(c.createdAt)}</span>
                                {c.filesChanged ? (
                                  <>
                                    <span>·</span>
                                    <span>{c.filesChanged}f</span>
                                  </>
                                ) : null}
                              </div>
                              {task ? (
                                <p className="mt-0.5 truncate text-[10px] text-fg-3">
                                  → {task.title}
                                </p>
                              ) : null}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Detail */}
        <section className="flex min-h-0 flex-col">
          {selectedId ? (
            loading ? (
              <div className="flex flex-1 items-center justify-center text-[13px] text-fg-3">
                Loading diff…
              </div>
            ) : error ? (
              <div className="flex flex-1 items-center justify-center px-6">
                <div className="rounded-lg border border-err/40 bg-err-soft px-4 py-3 text-[12px] text-err">
                  {error}
                </div>
              </div>
            ) : detail ? (
              <CommitDetailView
                detail={detail}
                agent={detail.agentId ? agentById.get(detail.agentId) : null}
                task={detail.taskId ? taskById.get(detail.taskId) : null}
              />
            ) : null
          ) : (
            <div className="flex flex-1 items-center justify-center text-[13px] text-fg-3">
              Pick a commit on the left
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/* ─────────────────────── Detail view ──────────────────────────── */
function CommitDetailView({
  detail,
  agent,
  task,
}: {
  detail: CommitDetail;
  agent: ReturnType<typeof useBoardStore.getState>['agents'][number] | null | undefined;
  task: ReturnType<typeof useBoardStore.getState>['tasks'][number] | null | undefined;
}) {
  const fileStats = useMemo(() => parseStats(detail.stats), [detail.stats]);
  const totalAdds = fileStats.reduce((a, f) => a + f.additions, 0);
  const totalDels = fileStats.reduce((a, f) => a + f.deletions, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Sticky header */}
      <header className="shrink-0 border-b border-hairline bg-canvas-raised/60 px-6 py-4 backdrop-blur-xl">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[13px] text-violet-bright tnum">
            {detail.sha.slice(0, 12)}
          </span>
          {detail.branch ? (
            <span className="pill">⎇ {detail.branch}</span>
          ) : null}
          <span className="ml-auto text-[11px] text-fg-3">
            {relativeTime(detail.createdAt)}
          </span>
        </div>
        <h2 className="mt-2 text-[16px] font-medium leading-snug tracking-tight text-fg">
          {detail.message}
        </h2>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-fg-3">
          {agent ? (
            <Link
              to={`/agents/${agent.id}`}
              className="inline-flex items-center gap-1.5 hover:text-fg"
            >
              <AgentAvatar agent={agent} size="sm" />
              <span className="font-mono">{agent.name}</span>
            </Link>
          ) : null}
          {task ? (
            <>
              <span className="text-fg-3">·</span>
              <span className="truncate font-mono" title={task.title}>
                task: {task.title}
              </span>
            </>
          ) : null}
          <span className="text-fg-3">·</span>
          <span className="font-mono tnum">
            <span className="text-ok">+{totalAdds}</span>{' '}
            <span className="text-err">−{totalDels}</span>{' '}
            <span className="text-fg-3">across {fileStats.length} files</span>
          </span>
        </div>
      </header>

      {/* File summary strip */}
      {fileStats.length > 0 ? (
        <details className="shrink-0 border-b border-hairline bg-sheen/[0.02] px-6 py-2">
          <summary className="cursor-pointer text-[11px] text-fg-2 hover:text-fg">
            Files changed ({fileStats.length})
          </summary>
          <ul className="mt-2 space-y-0.5 font-mono text-[11px]">
            {fileStats.map((f) => (
              <li key={f.path} className="flex items-center gap-2">
                <a
                  href={`#diff-${cssEscape(f.path)}`}
                  className="min-w-0 flex-1 truncate text-fg hover:underline"
                  title={f.path}
                >
                  {f.path}
                </a>
                <span className="tnum text-ok">+{f.additions}</span>
                <span className="tnum text-err">−{f.deletions}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {/* Diff body */}
      <div className="min-h-0 flex-1 overflow-auto bg-canvas-sunken/40">
        <pre className="whitespace-pre px-6 py-4 font-mono text-[12px] leading-relaxed">
          {colorizeDiff(detail.diff)}
        </pre>
      </div>
    </div>
  );
}

/* ──────────────── helpers ──────────────── */

interface DayGroup {
  label: string;
  commits: Commit[];
}
function groupByDay(commits: Commit[]): DayGroup[] {
  const out = new Map<string, Commit[]>();
  for (const c of commits) {
    const d = new Date(c.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const arr = out.get(key);
    if (arr) arr.push(c);
    else out.set(key, [c]);
  }
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const fmt = (k: string) => {
    const d = new Date(k + 'T00:00:00');
    if (sameDay(d, today)) return 'Today';
    if (sameDay(d, yesterday)) return 'Yesterday';
    return d.toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  };
  return [...out.entries()].map(([k, cs]) => ({ label: fmt(k), commits: cs }));
}
function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function shortTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

interface FileStat {
  path: string;
  additions: number;
  deletions: number;
}
/**
 * Parse the `git show --stat` text the backend sends. Looks for the trailing
 * "<path> | <count> +++---" lines so the UI can render a per-file summary.
 */
function parseStats(stats: string): FileStat[] {
  const out: FileStat[] = [];
  for (const line of stats.split('\n')) {
    const m = line.match(/^\s*(.+?)\s+\|\s+(\d+|Bin)(?:\s+([+\-]+))?\s*$/);
    if (!m) continue;
    const path = m[1]!.trim();
    if (!path) continue;
    const total = m[2] === 'Bin' ? 0 : Number(m[2]);
    const marks = m[3] ?? '';
    const plus = (marks.match(/\+/g) ?? []).length;
    const minus = (marks.match(/-/g) ?? []).length;
    // Heuristic: scale the +/- ratio by total when the visualization clipped.
    const additions = plus + minus === 0 ? 0 : Math.round((plus / (plus + minus)) * total);
    const deletions = total - additions;
    out.push({ path, additions, deletions });
  }
  return out;
}

function cssEscape(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function colorizeDiff(raw: string): React.ReactNode {
  const lines = raw.split('\n');
  return lines.map((line, i) => {
    let className = 'text-fg-2';
    if (line.startsWith('+') && !line.startsWith('+++')) className = 'text-ok';
    else if (line.startsWith('-') && !line.startsWith('---')) className = 'text-err';
    else if (line.startsWith('@@')) className = 'text-violet-bright';
    else if (line.startsWith('diff ') || line.startsWith('index ')) className = 'text-fg-3';
    else if (line.startsWith('+++') || line.startsWith('---')) className = 'text-fg-3';
    // Anchor a few lines above each `+++ b/<path>` so the file-list links work.
    if (line.startsWith('+++ b/')) {
      const path = line.slice('+++ b/'.length);
      return (
        <span key={i} id={`diff-${cssEscape(path)}`} className={['block scroll-mt-12', className].join(' ')}>
          {line || ' '}
        </span>
      );
    }
    return (
      <span key={i} className={['block', className].join(' ')}>
        {line || ' '}
      </span>
    );
  });
}

function FilterChip({
  active,
  label,
  onClick,
  children,
  title,
}: {
  active: boolean;
  label?: string;
  onClick: () => void;
  children?: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={[
        'rounded-full border px-2.5 py-1 text-[11px] transition',
        active
          ? 'border-violet/50 bg-violet-soft text-fg shadow-glow-sm'
          : 'border-hairline bg-sheen/[0.02] text-fg-2 hover:border-hairline-strong hover:text-fg',
      ].join(' ')}
    >
      {children ?? label}
    </button>
  );
}
