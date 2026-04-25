import { useMemo, useState } from 'react';
import { useBoardStore } from '@/lib/store';
import { AgentCard } from '@/components/AgentCard';
import { AgentNewDialog } from '@/components/AgentNewDialog';
import { PageHeader } from '@/components/PageHeader';
import { AGENT_ROLES, type AgentRole } from '@agentboard/shared';
import { ROLE_TINT } from '@/lib/roles';

type RoleFilter = 'all' | AgentRole;

// Short, single-word filter labels. The full title still shows on the
// agent card itself — chips are just navigation, they don't need the
// formal "Database Administrator" / "Language Specialist" wording.
const ROLE_SHORT: Record<AgentRole, string> = {
  pm: 'PM',
  cto: 'CTO',
  'ui-ux': 'UI/UX',
  'lang-specialist': 'Language',
  frontend: 'Frontend',
  backend: 'Backend',
  dba: 'DBA',
  qa: 'QA',
  cybersec: 'Security',
};

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
          <button type="button" className="btn btn-sm" onClick={() => setCreating(true)}>
            <span className="text-sm leading-none">+</span>
            New agent
          </button>
        }
      />

      {/* Filter rail — its own row so 9 chips never push the title around */}
      <div className="shrink-0 border-b border-hairline">
        <div className="flex items-center gap-1.5 overflow-x-auto px-6 py-2 [scrollbar-width:thin]">
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
              label={ROLE_SHORT[r] ?? AGENT_ROLES[r]?.title ?? r}
              count={n}
              tint={ROLE_TINT[r]}
              title={AGENT_ROLES[r]?.title ?? r}
            />
          ))}
        </div>
      </div>

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
  tint,
  title,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tint?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={[
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] transition duration-150',
        active
          ? 'border-accent/50 bg-accent-soft text-fg'
          : 'border-hairline bg-sheen/[0.02] text-fg-2 hover:border-hairline-strong hover:text-fg',
      ].join(' ')}
    >
      <span className={!active && tint ? tint : ''}>{label}</span>
      <span
        className={[
          'rounded-md bg-sheen/[0.06] px-1 font-mono text-[10px] tnum',
          active ? 'text-fg' : 'text-fg-3',
        ].join(' ')}
      >
        {count}
      </span>
    </button>
  );
}
