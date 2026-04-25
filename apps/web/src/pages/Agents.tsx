import { useMemo, useState } from 'react';
import { useBoardStore } from '@/lib/store';
import { AgentCard } from '@/components/AgentCard';
import { AgentNewDialog } from '@/components/AgentNewDialog';
import { PageHeader } from '@/components/PageHeader';
import { AGENT_ROLES, type AgentRole } from '@agentboard/shared';

type RoleFilter = 'all' | AgentRole;

export function Agents() {
  const agents = useBoardStore((s) => s.agents);
  const tasks = useBoardStore((s) => s.tasks);
  const messages = useBoardStore((s) => s.messages);

  const [filter, setFilter] = useState<RoleFilter>('all');
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(
    () => (filter === 'all' ? agents : agents.filter((a) => a.role === filter)),
    [agents, filter],
  );

  const roles = useMemo(() => {
    const byRole = new Map<AgentRole, number>();
    for (const a of agents) byRole.set(a.role, (byRole.get(a.role) ?? 0) + 1);
    return [...byRole.entries()].sort((a, b) => b[1] - a[1]);
  }, [agents]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        eyebrow="Agents"
        title="Team"
        subtitle={
          <>
            <span className="text-fg tnum">{agents.length}</span>{' '}
            {agents.length === 1 ? 'correspondent' : 'correspondents'} on retainer
          </>
        }
        actions={
          <>
            <div className="flex items-center gap-1.5">
              <FilterChip
                active={filter === 'all'}
                onClick={() => setFilter('all')}
                label="All"
                count={agents.length}
              />
              {roles.map(([r, n]) => (
                <FilterChip
                  key={r}
                  active={filter === r}
                  onClick={() => setFilter(r)}
                  label={AGENT_ROLES[r]?.title ?? r}
                  count={n}
                />
              ))}
            </div>
            <span className="mx-1 h-5 w-px bg-hairline" />
            <button type="button" className="btn btn-sm" onClick={() => setCreating(true)}>
              <span className="text-sm leading-none">＋</span>
              New
            </button>
          </>
        }
      />

      <div className="grid flex-1 gap-3 overflow-auto px-6 py-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center rounded-2xl border border-dashed border-hairline py-16 text-center">
            <span className="text-[15px] font-medium text-fg-3">No agents match this filter</span>
            <p className="mt-2 max-w-md text-[11px] text-fg-2">
              Hire one above, or run{' '}
              <code className="rounded border border-hairline bg-sheen/[0.04] px-1.5 py-0.5 font-mono text-fg">
                pnpm db:seed
              </code>{' '}
              to create the starter team.
            </p>
          </div>
        ) : (
          filtered.map((a) => <AgentCard key={a.id} agent={a} tasks={tasks} messages={messages} />)
        )}
      </div>

      {creating ? <AgentNewDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition duration-150',
        active
          ? 'border-violet/50 bg-violet-soft text-fg shadow-glow-sm'
          : 'border-hairline bg-sheen/[0.02] text-fg-2 hover:border-hairline-strong hover:text-fg',
      ].join(' ')}
    >
      <span>{label}</span>
      <span className={['tnum text-[10px]', active ? 'text-violet-bright' : 'text-fg-3'].join(' ')}>
        {count}
      </span>
    </button>
  );
}
