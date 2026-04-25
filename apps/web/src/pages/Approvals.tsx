import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBoardStore } from '@/lib/store';
import { AgentAvatar } from '@/components/AgentAvatar';
import { PageHeader } from '@/components/PageHeader';
import { relativeTime } from '@/lib/time';
import * as api from '@/lib/api';
import type { Approval } from '@/lib/types';

type Filter = 'pending' | 'approved' | 'rejected' | 'all';

export function Approvals() {
  const approvals = useBoardStore((s) => s.approvals);
  const agents = useBoardStore((s) => s.agents);
  const tasks = useBoardStore((s) => s.tasks);
  const [filter, setFilter] = useState<Filter>('pending');
  const [resolving, setResolving] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const filtered = useMemo(() => {
    const xs = filter === 'all' ? approvals : approvals.filter((a) => a.status === filter);
    return xs
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [approvals, filter]);

  const pendingCount = approvals.filter((a) => a.status === 'pending').length;

  async function resolve(id: string, approved: boolean) {
    if (resolving) return;
    setResolving(id);
    try {
      await api.resolveApproval(id, {
        approved,
        note: note.trim() || undefined,
      });
      setNote('');
      setOpenId(null);
      // store listens to event, but also refresh explicitly for instant UI
      const fresh = await api.listApprovals();
      useBoardStore.setState({ approvals: fresh });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Resolve failed');
    } finally {
      setResolving(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        eyebrow="Approvals"
        title="Human gate"
        subtitle={
          <>
            <span className="text-warn tnum">{pendingCount}</span> pending ·{' '}
            <span className="text-fg tnum">{approvals.length}</span> total
          </>
        }
        actions={
          <div className="flex items-center gap-1.5">
            <Chip active={filter === 'pending'} onClick={() => setFilter('pending')}>
              <span className="inline-flex items-center gap-1.5">
                {pendingCount > 0 ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-warn animate-breath" />
                ) : null}
                Pending · {approvals.filter((a) => a.status === 'pending').length}
              </span>
            </Chip>
            <Chip active={filter === 'approved'} onClick={() => setFilter('approved')}>
              Approved
            </Chip>
            <Chip active={filter === 'rejected'} onClick={() => setFilter('rejected')}>
              Rejected
            </Chip>
            <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
              All
            </Chip>
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-hairline py-20 text-center">
            <span className="text-[14px] text-fg-3">Nothing here</span>
            <p className="mt-2 max-w-md text-[11px] text-fg-2">
              {filter === 'pending'
                ? "No agent is waiting on your call. They'll pop a card up here via the `request_approval` tool when they hit something worth deciding by hand."
                : 'No records match this filter.'}
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {filtered.map((a) => {
              const agent = a.agentId ? agentById.get(a.agentId) : null;
              const task = a.taskId ? taskById.get(a.taskId) : null;
              const isOpen = openId === a.id;
              return (
                <li key={a.id}>
                  <article className="glass overflow-hidden p-0">
                    <header className="flex items-start gap-3 p-4">
                      {agent ? (
                        <AgentAvatar agent={agent} size="md" showStatus />
                      ) : (
                        <span className="inline-block h-10 w-10 rounded-full bg-sheen/[0.08]" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="min-w-0 flex-1 text-[15px] font-medium tracking-tight text-fg">
                            {a.title}
                          </h3>
                          <StatusPill status={a.status} />
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-fg-3">
                          {agent ? (
                            <Link to={`/agents/${agent.id}`} className="hover:text-fg">
                              {agent.name}
                            </Link>
                          ) : null}
                          {task ? (
                            <>
                              <span>·</span>
                              <span className="truncate" title={task.title}>
                                task: {task.title}
                              </span>
                            </>
                          ) : null}
                          <span>·</span>
                          <span>{relativeTime(a.createdAt)}</span>
                          {a.resolvedAt ? (
                            <>
                              <span>·</span>
                              <span>resolved {relativeTime(a.resolvedAt)}</span>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </header>

                    {a.description ? (
                      <div className="border-t border-hairline px-4 py-3">
                        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-fg-2">
                          {a.description}
                        </p>
                      </div>
                    ) : null}

                    {a.response ? (
                      <div className="border-t border-hairline bg-sheen/[0.02] px-4 py-3">
                        <span className="eyebrow">Your note</span>
                        <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-fg">
                          {a.response}
                        </p>
                      </div>
                    ) : null}

                    {a.status === 'pending' ? (
                      <footer className="border-t border-hairline bg-sheen/[0.015] px-4 py-3">
                        {isOpen ? (
                          <div className="space-y-3">
                            <label className="flex flex-col gap-1">
                              <span className="eyebrow">Note (optional)</span>
                              <textarea
                                className="textarea min-h-[80px]"
                                placeholder="Context or conditions the agent should carry forward…"
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                autoFocus
                              />
                            </label>
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                className="btn-ghost btn-sm"
                                onClick={() => {
                                  setOpenId(null);
                                  setNote('');
                                }}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="btn-danger btn-sm"
                                disabled={resolving === a.id}
                                onClick={() => resolve(a.id, false)}
                              >
                                {resolving === a.id ? '…' : 'Reject'}
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm"
                                disabled={resolving === a.id}
                                onClick={() => resolve(a.id, true)}
                              >
                                {resolving === a.id ? '…' : 'Approve'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => {
                              setOpenId(a.id);
                              setNote('');
                            }}
                          >
                            Decide
                          </button>
                        )}
                      </footer>
                    ) : null}
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

function StatusPill({ status }: { status: Approval['status'] }) {
  if (status === 'pending') return <span className="pill pill-warn">pending</span>;
  if (status === 'approved') return <span className="pill pill-ok">approved</span>;
  return <span className="pill pill-err">rejected</span>;
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
