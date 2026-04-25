import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBoardStore } from '@/lib/store';
import { AgentAvatar } from '@/components/AgentAvatar';
import { AgentGraph } from '@/components/AgentGraph';
import { AGENT_ROLES } from '@agentboard/shared';
import { ROLE_TINT, STATUS_DOT } from '@/lib/roles';
import { relativeTime } from '@/lib/time';
import type { Agent } from '@/lib/types';

type LiveView = 'swimlanes' | 'graph';

export function Live() {
  const agents = useBoardStore((s) => s.agents);
  const activity = useBoardStore((s) => s.activity);
  const messages = useBoardStore((s) => s.messages);

  const [paused, setPaused] = useState(false);
  const [selectedId, setSelectedId] = useState<string | 'all' | 'working'>('all');
  const [view, setView] = useState<LiveView>('swimlanes');

  const visibleAgents = useMemo(() => {
    if (selectedId === 'all') return agents;
    if (selectedId === 'working') return agents.filter((a) => a.status === 'working');
    return agents.filter((a) => a.id === selectedId);
  }, [agents, selectedId]);

  const perAgent = useMemo(() => {
    const map = new Map<string, FeedItem[]>();
    for (const a of agents) map.set(a.id, []);

    for (const item of activity) {
      if (!item.agentId) continue;
      map.get(item.agentId)?.push({
        id: `a-${item.id}`,
        kind: item.eventType,
        at: item.createdAt,
        payload: item.payload,
      });
    }

    const nameToId = new Map(agents.map((a) => [a.name, a.id]));
    for (const m of messages.slice(0, 100)) {
      const senderId = m.from === 'stakeholder' ? null : nameToId.get(m.from);
      if (senderId && map.has(senderId)) {
        map.get(senderId)?.push({
          id: `m-${m.id}`,
          kind: 'message.sent',
          at: m.createdAt,
          payload: { to: m.to, subject: m.subject, messageType: m.type },
        });
      }
    }

    for (const [k, list] of map) {
      list.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
      if (list.length > 60) list.length = 60;
      map.set(k, list);
    }
    return map;
  }, [activity, messages, agents]);

  const workingCount = agents.filter((a) => a.status === 'working').length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Compact single-row header */}
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-hairline px-6 py-3">
        <div className="flex items-baseline gap-3">
          <span className="eyebrow">Mission Control</span>
          <span className="text-[12px] text-fg-2">
            <span className="text-fg tnum">{workingCount}</span> of{' '}
            <span className="text-fg tnum">{agents.length}</span> working
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* View toggle */}
          <div className="mr-2 inline-flex rounded-full border border-hairline bg-sheen/[0.02] p-0.5">
            <ViewToggleButton active={view === 'swimlanes'} onClick={() => setView('swimlanes')}>
              <GridIcon />
              <span>Swimlanes</span>
            </ViewToggleButton>
            <ViewToggleButton active={view === 'graph'} onClick={() => setView('graph')}>
              <GraphIcon />
              <span>Graph</span>
            </ViewToggleButton>
          </div>
          {view === 'swimlanes' ? (
            <>
              <FilterChip active={selectedId === 'all'} onClick={() => setSelectedId('all')}>
                All
              </FilterChip>
              <FilterChip active={selectedId === 'working'} onClick={() => setSelectedId('working')}>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={[
                      'h-1.5 w-1.5 rounded-full bg-warn',
                      workingCount > 0 ? 'animate-breath' : '',
                    ].join(' ')}
                  />
                  Working {workingCount}
                </span>
              </FilterChip>
              {agents.map((a) => (
                <FilterChip
                  key={a.id}
                  active={selectedId === a.id}
                  onClick={() => setSelectedId(a.id)}
                  title={a.name}
                >
                  <AgentAvatar agent={a} size="sm" />
                </FilterChip>
              ))}
            </>
          ) : null}
          <span className="mx-1 h-5 w-px bg-hairline" />
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            className={paused ? 'btn btn-sm' : 'btn-ghost btn-sm'}
            aria-pressed={paused}
            title={paused ? 'Resume' : 'Pause'}
          >
            {paused ? '▶' : '⏸'}
          </button>
        </div>
      </header>

      {/* Body — swimlane grid OR graph */}
      {view === 'graph' ? (
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <AgentGraph agents={agents} messages={messages} />
        </div>
      ) : (
        <div
          className="grid min-h-0 flex-1 gap-3 overflow-hidden p-3"
          style={{
            gridTemplateColumns: `repeat(${Math.min(Math.max(visibleAgents.length, 1), 4)}, minmax(220px, 1fr))`,
            gridAutoRows: 'minmax(0, 1fr)',
          }}
        >
          {visibleAgents.length === 0 ? (
            <div className="col-span-full flex items-center justify-center rounded-xl border border-dashed border-hairline">
              <span className="text-[12px] text-fg-3">Nothing matches this filter.</span>
            </div>
          ) : (
            visibleAgents.map((a) => (
              <Swimlane
                key={a.id}
                agent={a}
                items={perAgent.get(a.id) ?? []}
                paused={paused}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────── View toggle ─────────────────────────── */
function ViewToggleButton({
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
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] transition',
        active ? 'bg-accent text-white shadow-glow-sm' : 'text-fg-2 hover:text-fg',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-3.5 w-3.5">
      <rect x="3" y="3" width="7" height="18" rx="1.2" />
      <rect x="14" y="3" width="7" height="10" rx="1.2" />
      <rect x="14" y="17" width="7" height="4" rx="1.2" />
    </svg>
  );
}
function GraphIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="h-3.5 w-3.5">
      <circle cx="12" cy="12" r="2.5" />
      <circle cx="5" cy="6" r="1.8" />
      <circle cx="19" cy="6" r="1.8" />
      <circle cx="5" cy="18" r="1.8" />
      <circle cx="19" cy="18" r="1.8" />
      <path d="M6.5 7l4 4M17.5 7l-4 4M6.5 17l4-4M17.5 17l-4-4" />
    </svg>
  );
}

/* ────────────────────────── Swimlane ──────────────────────────── */
function Swimlane({
  agent,
  items,
  paused,
}: {
  agent: Agent;
  items: FeedItem[];
  paused: boolean;
}) {
  const role = AGENT_ROLES[agent.role];
  const status = STATUS_DOT[agent.status];
  const tint = ROLE_TINT[agent.role];

  const [frozen, setFrozen] = useState<FeedItem[] | null>(null);
  const rendered = paused ? (frozen ?? items) : items;
  if (paused && frozen === null) setFrozen(items);
  if (!paused && frozen !== null) setFrozen(null);

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-hairline bg-sheen/[0.015]">
      <header className="flex shrink-0 items-center gap-2 border-b border-hairline bg-canvas-raised/60 px-2.5 py-2 backdrop-blur-xl">
        <Link to={`/agents/${agent.id}`} className="shrink-0">
          <AgentAvatar agent={agent} size="sm" showStatus />
        </Link>
        <Link
          to={`/agents/${agent.id}`}
          className="min-w-0 flex-1 truncate text-[12px] font-medium text-fg hover:underline"
          title={`${agent.name} · ${role?.title ?? agent.role}`}
        >
          {agent.name}
        </Link>
        <span
          className={['shrink-0 text-[10px] tnum', tint ?? 'text-fg-3'].join(' ')}
          title={status.label}
        >
          {rendered.length}
        </span>
      </header>

      <div className="flex-1 space-y-1.5 overflow-auto px-2 py-2 mask-fade-b">
        {rendered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center">
            <p className="text-[11px] text-fg-3">idle</p>
          </div>
        ) : (
          rendered.map((item, i) => (
            <EventTile key={item.id} item={item} animate={i === 0 && !paused} />
          ))
        )}
      </div>
    </section>
  );
}

/* ─────────────────────────── EventTile ────────────────────────── */
interface FeedItem {
  id: string;
  kind: string;
  at: string;
  payload: Record<string, unknown> | null;
}

function EventTile({ item, animate }: { item: FeedItem; animate: boolean }) {
  const baseClass = animate ? 'animate-float-in' : '';

  if (item.kind === 'agent.thinking') {
    const text = String((item.payload as { text?: string })?.text ?? '');
    const trimmed = text.length > 240 ? text.slice(0, 240) + '…' : text;
    return (
      <article
        className={[
          'rounded-lg border border-violet/25 bg-violet-soft/40 px-2.5 py-1.5',
          baseClass,
        ].join(' ')}
      >
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider text-violet-bright">
            <span className="h-1 w-1 rounded-full bg-violet animate-breath" />
            thinking
          </span>
          <time className="text-[9px] text-fg-3 tnum">{relativeTime(item.at)}</time>
        </div>
        <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-[11px] leading-snug text-fg">
          {trimmed}
        </p>
      </article>
    );
  }

  if (item.kind === 'message.sent') {
    const p = item.payload as { to?: string; subject?: string } | null;
    return (
      <article
        className={[
          'flex items-center gap-1.5 rounded-lg border border-hairline bg-sheen/[0.02] px-2 py-1',
          baseClass,
        ].join(' ')}
      >
        <span className="shrink-0 text-[11px] text-[#b097ff]">✎</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-fg">
          <span className="text-fg-3">→ {p?.to ?? '?'}</span>{' '}
          {p?.subject ?? ''}
        </span>
        <time className="shrink-0 text-[9px] text-fg-3 tnum">{relativeTime(item.at)}</time>
      </article>
    );
  }

  if (item.kind === 'agent.tool_attempt' || item.kind === 'tool_call') {
    const p = item.payload as { tool?: string; input?: unknown } | null;
    const tool = prettyTool(p?.tool ?? '?');
    const inputHint = summarizeInput(p?.input);
    const attempting = item.kind === 'agent.tool_attempt';
    return (
      <article
        className={[
          'flex items-center gap-1.5 rounded-lg border px-2 py-1',
          attempting
            ? 'border-warn/40 bg-warn-soft'
            : 'border-hairline bg-sheen/[0.02]',
          baseClass,
        ].join(' ')}
      >
        <span className={['shrink-0 text-[11px]', attempting ? 'text-warn' : 'text-fg-2'].join(' ')}>
          {attempting ? '◦' : '●'}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg">
          {tool}
          {inputHint ? <span className="ml-1 text-fg-3">{inputHint}</span> : null}
        </span>
        <time className="shrink-0 text-[9px] text-fg-3 tnum">{relativeTime(item.at)}</time>
      </article>
    );
  }

  if (item.kind === 'commit.created') {
    const p = item.payload as { sha?: string; message?: string } | null;
    return (
      <article
        className={[
          'flex items-center gap-1.5 rounded-lg border border-stamp/40 bg-[rgba(184,148,92,0.08)] px-2 py-1',
          baseClass,
        ].join(' ')}
      >
        <span className="shrink-0 text-[11px] text-[#ffcc80]">⎇</span>
        <span className="shrink-0 font-mono text-[10px] text-[#ffcc80] tnum">
          {String(p?.sha ?? '').slice(0, 7)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-fg">{p?.message ?? ''}</span>
        <time className="shrink-0 text-[9px] text-fg-3 tnum">{relativeTime(item.at)}</time>
      </article>
    );
  }

  if (item.kind === 'agent.status') {
    const p = item.payload as { status?: string } | null;
    return (
      <article
        className={[
          'flex items-center justify-between rounded-lg border border-hairline bg-transparent px-2 py-0.5',
          baseClass,
        ].join(' ')}
      >
        <span className="font-mono text-[9px] uppercase tracking-wider text-fg-3">
          → <span className="text-fg">{p?.status ?? '?'}</span>
        </span>
        <time className="text-[9px] text-fg-3 tnum">{relativeTime(item.at)}</time>
      </article>
    );
  }

  const meta = KIND_META[item.kind] ?? { mark: '·', label: item.kind };
  return (
    <article
      className={[
        'flex items-center gap-1.5 rounded-lg border border-hairline bg-sheen/[0.02] px-2 py-0.5',
        baseClass,
      ].join(' ')}
    >
      <span className="shrink-0 text-[11px] text-fg-3">{meta.mark}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[10px] uppercase tracking-wider text-fg-3">
        {meta.label}
      </span>
      <time className="shrink-0 text-[9px] text-fg-3 tnum">{relativeTime(item.at)}</time>
    </article>
  );
}

const KIND_META: Record<string, { mark: string; label: string }> = {
  session_stop: { mark: '■', label: 'turn ended' },
  'task.created': { mark: '+', label: 'new task' },
  'task.updated': { mark: '▣', label: 'task moved' },
};

function prettyTool(tool: string): string {
  if (tool.startsWith('mcp__agentboard__')) return tool.slice('mcp__agentboard__'.length);
  return tool;
}

function summarizeInput(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  if ('command' in o && typeof o.command === 'string')
    return `· $ ${o.command.slice(0, 50)}`;
  if ('file_path' in o && typeof o.file_path === 'string') {
    const p = String(o.file_path);
    const short = p.split('/').slice(-2).join('/');
    return `· ${short}`;
  }
  if ('subject' in o && typeof o.subject === 'string') return `· "${o.subject.slice(0, 40)}"`;
  if ('title' in o && typeof o.title === 'string') return `· "${o.title.slice(0, 40)}"`;
  if ('message' in o && typeof o.message === 'string') return `· "${o.message.slice(0, 40)}"`;
  return null;
}

function FilterChip({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={[
        'rounded-full border px-2.5 py-1 text-[11px] transition duration-150',
        active
          ? 'border-violet/50 bg-violet-soft text-fg shadow-glow-sm'
          : 'border-hairline bg-sheen/[0.02] text-fg-2 hover:border-hairline-strong hover:text-fg',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
