import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBoardStore } from '@/lib/store';
import { AgentAvatar } from '@/components/AgentAvatar';
import { PageHeader } from '@/components/PageHeader';
import { relativeTime } from '@/lib/time';
import * as api from '@/lib/api';
import type { Preview } from '@/lib/types';

type Filter = 'all' | 'running' | 'stopped';
type Viewport = 'fluid' | 'mobile' | 'tablet';

const VIEWPORT_W: Record<Exclude<Viewport, 'fluid'>, number> = {
  mobile: 390,
  tablet: 820,
};

export function Previews() {
  const agents = useBoardStore((s) => s.agents);
  const tasks = useBoardStore((s) => s.tasks);

  const [previews, setPreviews] = useState<Preview[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [agentFilter, setAgentFilter] = useState<string | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>('fluid');

  async function refresh() {
    try {
      const all = await api.listPreviews();
      setPreviews(all);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load previews');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 6000);
    return () => clearInterval(t);
  }, []);

  const filtered = useMemo(() => {
    let xs = previews.slice();
    if (filter !== 'all') xs = xs.filter((p) => p.status === filter);
    if (agentFilter !== 'all') xs = xs.filter((p) => p.agentId === agentFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      xs = xs.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.projectName ?? '').toLowerCase().includes(q) ||
          (p.service ?? '').toLowerCase().includes(q),
      );
    }
    return xs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [previews, filter, agentFilter, search]);

  const grouped = useMemo(() => {
    const running: Preview[] = [];
    const stopped: Preview[] = [];
    for (const p of filtered) {
      if (p.status === 'running') running.push(p);
      else stopped.push(p);
    }
    return { running, stopped };
  }, [filtered]);

  useEffect(() => {
    if (!selectedId || !filtered.find((p) => p.id === selectedId)) {
      const firstRunning = filtered.find((p) => p.status === 'running');
      setSelectedId(firstRunning?.id ?? filtered[0]?.id ?? null);
    }
  }, [filtered, selectedId]);

  const selected = previews.find((p) => p.id === selectedId) ?? null;
  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const runningCount = previews.filter((p) => p.status === 'running').length;
  const stoppedCount = previews.length - runningCount;

  async function onStop(id: string) {
    try {
      await api.stopPreview(id);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Stop failed');
    }
  }

  const [starting, setStarting] = useState<string | null>(null);
  async function onStart(id: string) {
    if (starting) return;
    setStarting(id);
    try {
      await api.startPreview(id);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Start failed');
    } finally {
      setStarting(null);
    }
  }

  const agentCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of previews) {
      if (!p.agentId) continue;
      m.set(p.agentId, (m.get(p.agentId) ?? 0) + 1);
    }
    return m;
  }, [previews]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        eyebrow="Previews"
        title="Running apps"
        subtitle={
          <span className="inline-flex items-center gap-2 text-fg-2">
            <span className="inline-flex items-center gap-1.5">
              <span
                className={[
                  'h-1.5 w-1.5 rounded-full bg-ok',
                  runningCount > 0 ? 'animate-breath' : 'opacity-40',
                ].join(' ')}
              />
              <span className="text-fg tnum">{runningCount}</span> live
            </span>
            <span className="text-fg-3">·</span>
            <span>
              <span className="text-fg-2 tnum">{stoppedCount}</span> stopped
            </span>
          </span>
        }
        actions={
          <button type="button" className="btn-ghost btn-sm" onClick={refresh} title="Refresh">
            <Icon name="refresh" />
          </button>
        }
      />

      {error ? (
        <div className="border-b border-err/40 bg-err-soft px-6 py-2 text-[12px] text-err">
          {error}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[300px_1fr]">
        {/* Sidebar list */}
        <aside className="flex min-h-0 flex-col border-r border-hairline">
          <div className="shrink-0 space-y-2 border-b border-hairline px-3 py-2.5">
            <div className="relative">
              <Icon
                name="search"
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-3"
              />
              <input
                type="search"
                placeholder="Search previews"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input w-full py-1.5 pl-8 text-[12px]"
              />
            </div>
            <div className="flex items-center gap-1">
              <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
                All <Count>{previews.length}</Count>
              </Chip>
              <Chip active={filter === 'running'} onClick={() => setFilter('running')}>
                <span
                  className={[
                    'h-1.5 w-1.5 rounded-full bg-ok',
                    runningCount > 0 ? 'animate-breath' : 'opacity-40',
                  ].join(' ')}
                />
                Live <Count>{runningCount}</Count>
              </Chip>
              <Chip active={filter === 'stopped'} onClick={() => setFilter('stopped')}>
                Stopped <Count>{stoppedCount}</Count>
              </Chip>
            </div>
            {agentCounts.size > 1 ? (
              <select
                className="input w-full py-1 text-[12px]"
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
              >
                <option value="all">All agents</option>
                {[...agentCounts.entries()].map(([id, n]) => {
                  const a = agentById.get(id);
                  if (!a) return null;
                  return (
                    <option key={id} value={id}>
                      {a.name} · {n}
                    </option>
                  );
                })}
              </select>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {loading ? (
              <p className="px-6 py-6 text-[13px] text-fg-3">Loading…</p>
            ) : filtered.length === 0 ? (
              <EmptyList />
            ) : (
              <>
                {grouped.running.length > 0 ? (
                  <Group label="Live" count={grouped.running.length} dot="bg-ok">
                    {grouped.running.map((p) => (
                      <PreviewRow
                        key={p.id}
                        p={p}
                        agent={p.agentId ? agentById.get(p.agentId) ?? null : null}
                        task={p.taskId ? taskById.get(p.taskId) ?? null : null}
                        active={p.id === selectedId}
                        onSelect={() => setSelectedId(p.id)}
                        onStart={() => onStart(p.id)}
                        starting={starting === p.id}
                      />
                    ))}
                  </Group>
                ) : null}
                {grouped.stopped.length > 0 ? (
                  <Group label="Stopped" count={grouped.stopped.length} dot="bg-fg-3">
                    {grouped.stopped.map((p) => (
                      <PreviewRow
                        key={p.id}
                        p={p}
                        agent={p.agentId ? agentById.get(p.agentId) ?? null : null}
                        task={p.taskId ? taskById.get(p.taskId) ?? null : null}
                        active={p.id === selectedId}
                        onSelect={() => setSelectedId(p.id)}
                        onStart={() => onStart(p.id)}
                        starting={starting === p.id}
                      />
                    ))}
                  </Group>
                ) : null}
              </>
            )}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col">
          {selected ? (
            <PreviewDetail
              preview={selected}
              agent={selected.agentId ? agentById.get(selected.agentId) : null}
              task={selected.taskId ? taskById.get(selected.taskId) : null}
              viewport={viewport}
              onChangeViewport={setViewport}
              onStop={() => onStop(selected.id)}
              onStart={() => onStart(selected.id)}
              starting={starting === selected.id}
              onRefresh={refresh}
            />
          ) : (
            <EmptyDetail />
          )}
        </section>
      </div>
    </div>
  );
}

/* ────────────────────────── List bits ──────────────────────────── */

function Group({
  label,
  count,
  dot,
  children,
}: {
  label: string;
  count: number;
  dot: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-hairline bg-canvas-sunken/95 px-3 py-1.5 backdrop-blur">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-fg-3">
          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
          {label}
        </span>
        <span className="font-mono text-[10px] tnum text-fg-3">{count}</span>
      </header>
      <ul className="divide-y divide-hairline">{children}</ul>
    </section>
  );
}

function PreviewRow({
  p,
  agent,
  task,
  active,
  onSelect,
  onStart,
  starting,
}: {
  p: Preview;
  agent: ReturnType<typeof useBoardStore.getState>['agents'][number] | null;
  task: ReturnType<typeof useBoardStore.getState>['tasks'][number] | null;
  active: boolean;
  onSelect: () => void;
  onStart: () => void;
  starting: boolean;
}) {
  const isRunning = p.status === 'running';
  return (
    <li>
      <div
        className={[
          'group relative flex w-full items-center gap-2.5 px-3 py-2 transition',
          active ? 'bg-accent-soft' : 'hover:bg-sheen/[0.03]',
        ].join(' ')}
      >
        {active ? (
          <span className="absolute left-0 top-0 h-full w-0.5 bg-accent" aria-hidden />
        ) : null}
        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          {agent ? (
            <AgentAvatar agent={agent} size="sm" />
          ) : (
            <span className="inline-block h-6 w-6 shrink-0 rounded-full bg-sheen/[0.08]" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[12.5px] font-medium text-fg">{p.name}</span>
              {isRunning ? (
                <span
                  className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-ok animate-breath"
                  title="running"
                />
              ) : null}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-fg-3">
              {agent ? <span className="truncate">{agent.name}</span> : null}
              <span>·</span>
              <span className="font-mono tnum">:{p.hostPort}</span>
              <span>·</span>
              <span className="truncate">{relativeTime(p.createdAt)}</span>
            </div>
            {task?.title ? (
              <div className="mt-0.5 truncate text-[10.5px] text-fg-3" title={task.title}>
                <Icon name="task" className="mr-1 inline h-2.5 w-2.5 align-[-1px]" /> {task.title}
              </div>
            ) : null}
          </div>
        </button>
        {!isRunning ? (
          <button
            type="button"
            className="btn-ghost btn-sm shrink-0 opacity-0 transition group-hover:opacity-100"
            onClick={onStart}
            disabled={starting}
            title="Rebuild + run"
          >
            {starting ? '…' : <Icon name="play" />}
          </button>
        ) : null}
      </div>
    </li>
  );
}

function EmptyList() {
  return (
    <div className="p-6 text-center">
      <span className="text-[13px] text-fg-3">No previews</span>
      <p className="mt-2 text-[11px] text-fg-2">
        Agents publish previews via{' '}
        <code className="rounded bg-sheen/[0.06] px-1 font-mono">launch_preview</code> after they
        ship a Dockerfile or compose.yml in their worktree.
      </p>
    </div>
  );
}

function EmptyDetail() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-hairline bg-sheen/[0.03] text-fg-3">
        <Icon name="frame" className="h-5 w-5" />
      </span>
      <span className="text-[14px] text-fg-2">No preview selected</span>
      <p className="max-w-sm text-[11px] text-fg-3">
        When an agent calls{' '}
        <code className="rounded bg-sheen/[0.06] px-1 font-mono">launch_preview</code>, it shows up
        on the left. Pick one to embed it live.
      </p>
    </div>
  );
}

/* ────────────────────────── Detail pane ──────────────────────────── */
function PreviewDetail({
  preview,
  agent,
  task,
  viewport,
  onChangeViewport,
  onStop,
  onStart,
  starting,
  onRefresh,
}: {
  preview: Preview;
  agent: ReturnType<typeof useBoardStore.getState>['agents'][number] | null | undefined;
  task: ReturnType<typeof useBoardStore.getState>['tasks'][number] | null | undefined;
  viewport: Viewport;
  onChangeViewport: (v: Viewport) => void;
  onStop: () => void;
  onStart: () => void;
  starting: boolean;
  onRefresh: () => void;
}) {
  const [iframeKey, setIframeKey] = useState(0);
  const [iframeErr, setIframeErr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const canEmbed = preview.status === 'running';

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(preview.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  }

  return (
    <>
      {/* Title row — breathing room, never cut off */}
      <header className="shrink-0 border-b border-hairline px-4 pb-2 pt-3">
        <div className="flex items-start gap-3">
          <span
            className={[
              'mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full',
              preview.status === 'running' ? 'bg-ok animate-breath' : 'bg-fg-3',
            ].join(' ')}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-[15px] font-medium text-fg" title={preview.name}>
                {preview.name}
              </h2>
              {preview.service ? (
                <span className="pill text-[10px]">{preview.service}</span>
              ) : null}
              <span
                className={[
                  'pill text-[10px]',
                  preview.status === 'running'
                    ? 'border-ok/40 bg-ok/10 text-ok'
                    : 'text-fg-3',
                ].join(' ')}
              >
                {preview.status}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-fg-3">
              {agent ? (
                <Link to={`/agents/${agent.id}`} className="hover:text-fg">
                  {agent.name}
                </Link>
              ) : (
                <span>—</span>
              )}
              {task?.title ? (
                <>
                  <span>·</span>
                  <span className="inline-flex max-w-md items-center gap-1 truncate" title={task.title}>
                    <Icon name="task" className="h-2.5 w-2.5" />
                    <span className="truncate">{task.title}</span>
                  </span>
                </>
              ) : null}
              <span>·</span>
              <span className="font-mono tnum">:{preview.hostPort}</span>
              <span>·</span>
              <span>started {relativeTime(preview.createdAt)}</span>
            </div>
          </div>
        </div>

        {/* Toolbar — its own row so buttons never overlap the title or get clipped */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* URL chip is the address bar — takes available room */}
          <button
            type="button"
            onClick={copyUrl}
            className="inline-flex min-w-0 max-w-full flex-1 items-center gap-2 rounded-md border border-hairline bg-sheen/[0.03] px-2.5 py-1 font-mono text-[11px] text-fg-2 transition hover:border-hairline-strong hover:text-fg"
            title="Copy URL"
          >
            <Icon name="link" className="h-3 w-3 shrink-0 text-fg-3" />
            <span className="truncate">{preview.url}</span>
            {copied ? (
              <Icon name="check" className="h-3 w-3 shrink-0 text-ok" />
            ) : (
              <Icon name="copy" className="h-3 w-3 shrink-0 text-fg-3" />
            )}
          </button>

          {canEmbed ? (
            <ViewportSwitcher value={viewport} onChange={onChangeViewport} />
          ) : null}

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setShowInfo((s) => !s)}
              title="Info"
              aria-pressed={showInfo}
            >
              <Icon name="info" />
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => {
                setIframeErr(false);
                setIframeKey((k) => k + 1);
                onRefresh();
              }}
              title="Reload preview"
            >
              <Icon name="refresh" />
            </button>
            <a
              href={preview.url}
              target="_blank"
              rel="noreferrer"
              className={
                canEmbed
                  ? 'btn-ghost btn-sm inline-flex items-center'
                  : 'btn-ghost btn-sm pointer-events-none inline-flex items-center opacity-50'
              }
              title="Open in new tab"
            >
              <span>Open</span>
              <Icon name="external" className="ml-1 h-3 w-3" />
            </a>
            {preview.status === 'running' ? (
              <button type="button" className="btn-danger btn-sm" onClick={onStop}>
                Stop
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-sm inline-flex items-center"
                onClick={onStart}
                disabled={starting}
                title="Rebuild from the saved workdir and bring the container back up"
              >
                {starting ? (
                  <span>Starting…</span>
                ) : (
                  <>
                    <Icon name="play" className="mr-1 h-3 w-3" />
                    <span>Start</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Optional info drawer */}
      {showInfo ? (
        <div className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-1 border-b border-hairline bg-canvas-sunken/40 px-4 py-2 font-mono text-[10.5px] tnum text-fg-3 md:grid-cols-4">
          <Info label="port">:{preview.hostPort}</Info>
          <Info label="container">
            {preview.containerId ? preview.containerId.slice(0, 12) : '—'}
          </Info>
          <Info label="started">{relativeTime(preview.createdAt)}</Info>
          {preview.stoppedAt ? <Info label="stopped">{relativeTime(preview.stoppedAt)}</Info> : null}
          <div className="col-span-2 truncate md:col-span-4" title={preview.workdir}>
            <span className="text-fg-3/70">workdir</span>{' '}
            <span className="text-fg-2">
              {preview.workdir.replace(/^.*\/workspace\//, 'workspace/')}
            </span>
          </div>
          {preview.projectName ? (
            <div className="col-span-2 truncate md:col-span-4" title={preview.projectName}>
              <span className="text-fg-3/70">compose project</span>{' '}
              <span className="text-fg-2">{preview.projectName}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* The preview surface */}
      <div className="relative min-h-0 flex-1 bg-canvas-sunken">
        {canEmbed ? (
          iframeErr ? (
            <CantEmbed url={preview.url} />
          ) : (
            <div className="flex h-full w-full items-stretch justify-center p-4">
              <div
                className="flex h-full overflow-hidden rounded-lg border border-hairline bg-white shadow-[0_2px_30px_-12px_rgba(0,0,0,0.4)]"
                style={
                  viewport === 'fluid'
                    ? { width: '100%' }
                    : { width: `${VIEWPORT_W[viewport]}px`, maxWidth: '100%' }
                }
              >
                <iframe
                  key={iframeKey}
                  src={preview.url}
                  title={preview.name}
                  className="h-full w-full bg-white"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                  onError={() => setIframeErr(true)}
                />
              </div>
            </div>
          )
        ) : (
          <Stopped preview={preview} starting={starting} onStart={onStart} />
        )}
      </div>
    </>
  );
}

function ViewportSwitcher({
  value,
  onChange,
}: {
  value: Viewport;
  onChange: (v: Viewport) => void;
}) {
  return (
    <div className="hidden items-center rounded-md border border-hairline bg-sheen/[0.02] p-0.5 md:inline-flex">
      <ViewportBtn active={value === 'mobile'} onClick={() => onChange('mobile')} title="Mobile · 390px">
        <Icon name="phone" />
      </ViewportBtn>
      <ViewportBtn active={value === 'tablet'} onClick={() => onChange('tablet')} title="Tablet · 820px">
        <Icon name="tablet" />
      </ViewportBtn>
      <ViewportBtn active={value === 'fluid'} onClick={() => onChange('fluid')} title="Fluid · full width">
        <Icon name="desktop" />
      </ViewportBtn>
    </div>
  );
}

function ViewportBtn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={[
        'inline-flex h-6 w-7 items-center justify-center rounded transition',
        active ? 'bg-accent-soft text-fg' : 'text-fg-3 hover:text-fg',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function CantEmbed({ url }: { url: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
      <Icon name="lock" className="h-6 w-6 text-fg-3" />
      <span className="text-[14px] text-fg-2">Couldn't embed this preview.</span>
      <p className="max-w-md text-[11px] text-fg-3">
        The container may be returning <code>X-Frame-Options: DENY</code> or{' '}
        <code>Content-Security-Policy: frame-ancestors</code>. Open it directly in a new tab
        instead.
      </p>
      <a href={url} target="_blank" rel="noreferrer" className="btn btn-sm">
        Open {url} <Icon name="external" className="ml-1 h-3 w-3" />
      </a>
    </div>
  );
}

function Stopped({
  preview,
  starting,
  onStart,
}: {
  preview: Preview;
  starting: boolean;
  onStart: () => void;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-hairline bg-sheen/[0.03] text-fg-3">
        <Icon name="frame" className="h-5 w-5" />
      </span>
      <span className="text-[14px] text-fg-2">Preview stopped</span>
      <p className="max-w-sm text-[11px] text-fg-3">
        {preview.stoppedAt
          ? `Stopped ${relativeTime(preview.stoppedAt)}.`
          : 'Container is no longer running.'}{' '}
        Click <span className="text-fg">Start</span> to rebuild from the saved workdir — the
        agent's Dockerfile and compose.yml are reused, you'll get a fresh port.
      </p>
      <button type="button" className="btn btn-sm" onClick={onStart} disabled={starting}>
        {starting ? 'Starting…' : (<><Icon name="play" className="mr-1" />Start preview</>)}
      </button>
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="truncate">
      <span className="text-fg-3/70">{label}</span> <span className="text-fg-2">{children}</span>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition',
        active
          ? 'border-accent/40 bg-accent-soft text-fg'
          : 'border-hairline bg-sheen/[0.02] text-fg-2 hover:border-hairline-strong hover:text-fg',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function Count({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-0.5 rounded bg-sheen/[0.06] px-1 font-mono text-[10px] tnum text-fg-3">
      {children}
    </span>
  );
}

/* ────────────────────────── Tiny icon set ──────────────────────────
 * Inline SVGs avoid pulling a dependency. Each icon is 16×16 by default,
 * inherits currentColor, and accepts arbitrary className overrides.
 */
function Icon({ name, className }: { name: IconName; className?: string }) {
  const cls = ['inline-block h-4 w-4 shrink-0', className].filter(Boolean).join(' ');
  switch (name) {
    case 'search':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" className={cls}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      );
    case 'refresh':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={cls}>
          <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
          <path d="M3 21v-5h5" />
        </svg>
      );
    case 'play':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={cls}>
          <path d="M8 5v14l11-7z" />
        </svg>
      );
    case 'external':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={cls}>
          <path d="M14 4h6v6" />
          <path d="M20 4 11 13" />
          <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
        </svg>
      );
    case 'copy':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={cls}>
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a1 1 0 0 1 1-1h10" />
        </svg>
      );
    case 'check':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={cls}>
          <path d="m4 12 5 5L20 6" />
        </svg>
      );
    case 'info':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" className={cls}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8h.01" />
          <path d="M11 12h1v5h1" />
        </svg>
      );
    case 'task':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={cls}>
          <rect x="4" y="4" width="16" height="16" rx="3" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case 'frame':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className={cls}>
          <rect x="3" y="4" width="18" height="14" rx="2" />
          <path d="M3 9h18" />
          <path d="M8 4v5" />
        </svg>
      );
    case 'lock':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={cls}>
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V8a4 4 0 1 1 8 0v3" />
        </svg>
      );
    case 'phone':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={cls}>
          <rect x="7" y="3" width="10" height="18" rx="2" />
          <path d="M11 18h2" />
        </svg>
      );
    case 'tablet':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={cls}>
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <path d="M11 18h2" />
        </svg>
      );
    case 'desktop':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={cls}>
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M9 20h6" />
          <path d="M12 16v4" />
        </svg>
      );
    case 'link':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={cls}>
          <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07L11 5" />
          <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07L13 19" />
        </svg>
      );
  }
}

type IconName =
  | 'search'
  | 'refresh'
  | 'play'
  | 'external'
  | 'copy'
  | 'check'
  | 'info'
  | 'task'
  | 'frame'
  | 'lock'
  | 'phone'
  | 'tablet'
  | 'desktop'
  | 'link';
