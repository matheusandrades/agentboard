import { useMemo, useState } from 'react';
import { useBoardStore } from '@/lib/store';
import { ActivityItem } from '@/components/ActivityItem';
import { PageHeader } from '@/components/PageHeader';
import type { ActivityItem as ActivityItemType } from '@/lib/types';

type Filter = 'all' | 'messages' | 'commits' | 'tools' | 'thinking' | 'tasks' | 'approvals';

const FILTER_OPTIONS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'thinking', label: 'Thoughts' },
  { value: 'tools', label: 'Tools' },
  { value: 'messages', label: 'Messages' },
  { value: 'commits', label: 'Commits' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'approvals', label: 'Approvals' },
];

export function Timeline() {
  const activity = useBoardStore((s) => s.activity);
  const agents = useBoardStore((s) => s.agents);
  const [filter, setFilter] = useState<Filter>('all');
  const [order, setOrder] = useState<'newest' | 'oldest'>('newest');
  const [agentFilter, setAgentFilter] = useState<string | 'all'>('all');
  const [query, setQuery] = useState('');

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  // Per-type counts for the chip badges.
  const typeCounts = useMemo(() => {
    const c = { messages: 0, commits: 0, tools: 0, thinking: 0, tasks: 0, approvals: 0 };
    for (const i of activity) {
      switch (i.eventType) {
        case 'message.sent': c.messages++; break;
        case 'commit.created': c.commits++; break;
        case 'tool_call':
        case 'agent.tool_attempt': c.tools++; break;
        case 'agent.thinking': c.thinking++; break;
        case 'task.created':
        case 'task.updated': c.tasks++; break;
        case 'approval.requested':
        case 'approval.resolved': c.approvals++; break;
      }
    }
    return c;
  }, [activity]);

  const filtered = useMemo(() => {
    let xs = activity.slice();
    if (filter !== 'all') xs = xs.filter((i) => matchesFilter(i.eventType, filter));
    if (agentFilter !== 'all') xs = xs.filter((i) => i.agentId === agentFilter);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      xs = xs.filter((i) => JSON.stringify(i.payload ?? {}).toLowerCase().includes(q));
    }
    xs.sort((a, b) => {
      const da = new Date(a.createdAt).getTime();
      const db = new Date(b.createdAt).getTime();
      return order === 'newest' ? db - da : da - db;
    });
    return xs;
  }, [activity, filter, agentFilter, query, order]);

  // Group by hour bucket for sticky time markers.
  const grouped = useMemo(() => groupByBucket(filtered, order), [filtered, order]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        eyebrow="Timeline"
        title="Wire feed"
        subtitle={
          <>
            <span className="text-fg tnum">{filtered.length}</span> of{' '}
            <span className="text-fg tnum">{activity.length}</span> events
            {filter !== 'all' || agentFilter !== 'all' || query ? ' · filtered' : ''}
          </>
        }
        actions={
          <>
            <input
              type="search"
              placeholder="Search…"
              className="input py-1 text-[12px]"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ minWidth: 180 }}
            />
            <select
              className="input py-1 text-[12px]"
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              style={{ minWidth: 130 }}
            >
              <option value="all">All agents</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setOrder((o) => (o === 'newest' ? 'oldest' : 'newest'))}
              title={order === 'newest' ? 'Newest first (click for oldest)' : 'Oldest first'}
            >
              {order === 'newest' ? '↓ Newest' : '↑ Oldest'}
            </button>
          </>
        }
      />

      {/* Type filter strip */}
      <nav className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-hairline px-6 py-2">
        {FILTER_OPTIONS.map((o) => {
          const count =
            o.value === 'all'
              ? activity.length
              : typeCounts[o.value as keyof typeof typeCounts] ?? 0;
          return (
            <Chip
              key={o.value}
              active={filter === o.value}
              onClick={() => setFilter(o.value)}
            >
              {o.label}
              <span className={['tnum text-[10px]', filter === o.value ? 'text-violet-bright' : 'text-fg-3'].join(' ')}>
                {count}
              </span>
            </Chip>
          );
        })}
      </nav>

      {/* Feed */}
      <div className="min-h-0 flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
            <span className="text-[14px] text-fg-3">No events match</span>
            <p className="mt-2 max-w-md text-[11px] text-fg-2">
              Loosen the filters or wait — every tool call, message, commit, and approval lands here in real time.
            </p>
          </div>
        ) : (
          grouped.map((g) => (
            <div key={g.label}>
              <div className="sticky top-0 z-10 border-y border-hairline bg-canvas/95 px-6 py-1.5 backdrop-blur">
                <span className="eyebrow">{g.label}</span>
                <span className="ml-2 text-[10px] text-fg-3 tnum">{g.items.length}</span>
              </div>
              <ul className="divide-y divide-hairline">
                {g.items.map((item) => (
                  <ActivityItem
                    key={item.id}
                    item={item}
                    agent={item.agentId ? agentById.get(item.agentId) : null}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ───────── helpers ───────── */
function matchesFilter(eventType: string, filter: Filter): boolean {
  switch (filter) {
    case 'all':       return true;
    case 'messages':  return eventType === 'message.sent';
    case 'commits':   return eventType === 'commit.created';
    case 'tools':     return eventType === 'tool_call' || eventType === 'agent.tool_attempt';
    case 'thinking':  return eventType === 'agent.thinking';
    case 'tasks':     return eventType === 'task.created' || eventType === 'task.updated';
    case 'approvals': return eventType === 'approval.requested' || eventType === 'approval.resolved';
  }
}

interface Bucket {
  label: string;
  items: ActivityItemType[];
}
function groupByBucket(items: ActivityItemType[], order: 'newest' | 'oldest'): Bucket[] {
  const out = new Map<string, ActivityItemType[]>();
  const now = Date.now();
  for (const it of items) {
    const t = new Date(it.createdAt).getTime();
    const ageMin = (now - t) / 60_000;
    let key: string;
    if (ageMin < 5) key = 'live';
    else if (ageMin < 60) key = 'last_hour';
    else {
      const d = new Date(it.createdAt);
      const today = new Date();
      const yest = new Date();
      yest.setDate(today.getDate() - 1);
      if (sameDay(d, today)) key = 'earlier_today';
      else if (sameDay(d, yest)) key = 'yesterday';
      else
        key =
          d.toLocaleDateString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          });
    }
    const arr = out.get(key);
    if (arr) arr.push(it);
    else out.set(key, [it]);
  }
  const ordering = ['live', 'last_hour', 'earlier_today', 'yesterday'];
  const labels: Record<string, string> = {
    live: 'Just now · last 5 min',
    last_hour: 'Last hour',
    earlier_today: 'Earlier today',
    yesterday: 'Yesterday',
  };
  const entries = [...out.entries()];
  // Newer buckets first when order='newest'
  entries.sort(([a], [b]) => {
    const ai = ordering.indexOf(a);
    const bi = ordering.indexOf(b);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  if (order === 'oldest') entries.reverse();
  return entries.map(([k, items]) => ({ label: labels[k] ?? k, items }));
}
function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
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
          ? 'border-violet/50 bg-violet-soft text-fg shadow-glow-sm'
          : 'border-hairline bg-sheen/[0.02] text-fg-2 hover:border-hairline-strong hover:text-fg',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
