import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { useBoardStore } from '@/lib/store';
import { AgentAvatar } from '@/components/AgentAvatar';
import { ActivityPanel } from '@/components/ActivityPanel';
import { ROLE_TINT, STATUS_DOT } from '@/lib/roles';
import { relativeTime } from '@/lib/time';
import * as api from '@/lib/api';
import type { UsageSummary } from '@/lib/types';

const fmtTokens = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};
const fmtUsd = (micro: number) => `$${(micro / 1_000_000).toFixed(2)}`;

export function Dashboard() {
  const agents = useBoardStore((s) => s.agents);
  const tasks = useBoardStore((s) => s.tasks);
  const approvals = useBoardStore((s) => s.approvals);
  const previews = useBoardStore((s) => s.previews);
  const messages = useBoardStore((s) => s.messages);
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  useEffect(() => {
    void api
      .usage()
      .then(setUsage)
      .catch(() => undefined);
    const t = setInterval(() => {
      void api.usage().then(setUsage).catch(() => undefined);
    }, 30000);
    return () => clearInterval(t);
  }, []);

  const working = agents.filter((a) => a.status === 'working');
  const blocked = agents.filter((a) => a.status === 'blocked' || a.status === 'error');
  const pendingApprovals = approvals.filter((a) => a.status === 'pending');
  const runningPreviews = previews.filter((p) => p.status === 'running');
  const inProgressTasks = tasks.filter((t) => t.status === 'in_progress');
  const reviewTasks = tasks.filter((t) => t.status === 'review');
  const recentMessages = useMemo(
    () => messages.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5),
    [messages],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        eyebrow="Home"
        title="Mission control"
        subtitle={
          <>
            <span className="text-fg tnum">{agents.length}</span> agents ·{' '}
            <span className="text-fg tnum">{working.length}</span> working
            {blocked.length > 0 ? (
              <span className="text-err">
                {' '}· {blocked.length} blocked
              </span>
            ) : null}
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        {/* Above-the-fold live activity feed (553eea82). 30 events, 5s poll. */}
        <ActivityPanel />

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {/* Working agents */}
          <Card title="Working now" linkTo="/live" linkLabel="Live →">
            {working.length === 0 ? (
              <p className="text-[12px] text-fg-3">All idle. Try Chat (⌘K) to kick something off.</p>
            ) : (
              <ul className="space-y-2">
                {working.map((a) => (
                  <li key={a.id}>
                    <Link to={`/agents/${a.id}`} className="flex items-center gap-2 hover:underline">
                      <AgentAvatar agent={a} size="sm" showStatus />
                      <span className="text-[12.5px] text-fg">{a.name}</span>
                      <span className={['ml-auto pill text-[10px]', ROLE_TINT[a.role]].join(' ')}>
                        {a.role}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Pending approvals (highest priority) */}
          <Card
            title={`Pending approvals${pendingApprovals.length ? ` · ${pendingApprovals.length}` : ''}`}
            linkTo="/approvals"
            linkLabel="Review →"
            tone={pendingApprovals.length > 0 ? 'warn' : undefined}
          >
            {pendingApprovals.length === 0 ? (
              <p className="text-[12px] text-fg-3">Nothing waiting on you.</p>
            ) : (
              <ul className="space-y-1.5">
                {pendingApprovals.slice(0, 4).map((a) => (
                  <li key={a.id}>
                    <Link to="/approvals" className="line-clamp-1 text-[12.5px] text-fg hover:underline">
                      {a.title}
                    </Link>
                    <p className="text-[10px] text-fg-3">{relativeTime(a.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Usage */}
          <Card title="Usage" linkTo="/usage" linkLabel="Details →">
            {usage ? (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] text-fg-3">Today</span>
                  <span className="font-mono text-[18px] tnum text-fg">
                    {fmtTokens(usage.today.totalTokens)}
                    <span className="ml-1 text-[10px] text-fg-3">tok</span>
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] text-fg-3">Turns today</span>
                  <span className="font-mono text-[12px] tnum text-fg-2">{usage.today.turns}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] text-fg-3">All time</span>
                  <span className="font-mono text-[12px] tnum text-fg-2">
                    {fmtTokens(usage.totals.totalTokens)}
                  </span>
                </div>
                {usage.mode === 'api' ? (
                  <div className="mt-1 border-t border-hairline pt-1.5 flex items-baseline justify-between">
                    <span className="text-[10px] text-fg-3">Cost today</span>
                    <span className="font-mono text-[11px] tnum text-fg-2">
                      {fmtUsd(usage.today.costMicroUsd)}
                    </span>
                  </div>
                ) : (
                  <p className="mt-1 border-t border-hairline pt-1.5 text-[10px] text-fg-3">
                    Subscription mode — no per-token billing.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-[12px] text-fg-3">—</p>
            )}
          </Card>

          {/* In progress / review */}
          <Card title="On the board" linkTo="/board" linkLabel="Board →">
            <div className="grid grid-cols-2 gap-3 text-[11px]">
              <Counter label="In progress" value={inProgressTasks.length} />
              <Counter label="In review" value={reviewTasks.length} />
            </div>
            {[...inProgressTasks, ...reviewTasks].slice(0, 3).map((t) => (
              <p key={t.id} className="mt-2 line-clamp-1 text-[12px] text-fg">
                ▸ {t.title}
              </p>
            ))}
          </Card>

          {/* Running previews */}
          <Card title={`Running previews${runningPreviews.length ? ` · ${runningPreviews.length}` : ''}`} linkTo="/previews" linkLabel="Open →">
            {runningPreviews.length === 0 ? (
              <p className="text-[12px] text-fg-3">No live containers.</p>
            ) : (
              <ul className="space-y-1.5">
                {runningPreviews.slice(0, 3).map((p) => (
                  <li key={p.id} className="flex items-center justify-between">
                    <Link to="/previews" className="truncate text-[12px] text-fg hover:underline">
                      {p.name}
                    </Link>
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="pill pill-ok text-[10px]"
                    >
                      :{p.hostPort} ↗
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Recent activity card moved into the prominent ActivityPanel above. */}
        </div>

        {/* Recent stakeholder thread (compact) */}
        {recentMessages.length > 0 ? (
          <section className="mt-6">
            <h3 className="eyebrow mb-2">Recent dispatches</h3>
            <ul className="space-y-1.5">
              {recentMessages.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-3 rounded-xl border border-hairline bg-sheen/[0.02] px-4 py-2"
                >
                  <span className="font-mono text-[10px] uppercase tracking-wider text-fg-3 w-20">
                    {m.type}
                  </span>
                  <span className="text-[11px] text-fg-3">
                    {m.from} → {m.to}
                  </span>
                  <span className="line-clamp-1 flex-1 text-[12px] text-fg">{m.subject}</span>
                  <span className="text-[10px] text-fg-3">{relativeTime(m.createdAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function Card({
  title,
  children,
  linkTo,
  linkLabel,
  tone,
}: {
  title: string;
  children: React.ReactNode;
  linkTo?: string;
  linkLabel?: string;
  tone?: 'warn' | 'err';
}) {
  return (
    <article
      className={[
        'glass p-4',
        tone === 'warn' ? 'border-warn/40' : tone === 'err' ? 'border-err/40' : '',
      ].join(' ')}
    >
      <header className="mb-2 flex items-center justify-between">
        <h3 className="eyebrow">{title}</h3>
        {linkTo ? (
          <Link to={linkTo} className="text-[11px] text-accent hover:underline">
            {linkLabel}
          </Link>
        ) : null}
      </header>
      {children}
    </article>
  );
}
function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-hairline bg-sheen/[0.02] p-2 text-center">
      <span className="block text-[10px] text-fg-3">{label}</span>
      <span className="font-mono text-[20px] tnum text-fg">{value}</span>
    </div>
  );
}
