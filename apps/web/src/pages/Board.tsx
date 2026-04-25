import { useMemo, useState } from 'react';
import { useBoardStore } from '@/lib/store';
import { KanbanBoard } from '@/components/KanbanBoard';
import { PageHeader } from '@/components/PageHeader';

export function Board() {
  const sprints = useBoardStore((s) => s.sprints);
  const tasks = useBoardStore((s) => s.tasks);
  const active = useMemo(
    () => sprints.find((s) => s.status === 'active') ?? sprints[0],
    [sprints],
  );
  const [selection, setSelection] = useState<string | null | undefined>(undefined);
  const selectedId = selection === undefined ? (active?.id ?? null) : selection;
  const selectedSprint = sprints.find((s) => s.id === selectedId);
  const filteredCount = selectedId
    ? tasks.filter((t) => t.sprintId === selectedId).length
    : tasks.length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        eyebrow="Board"
        title="Kanban"
        subtitle={
          <>
            <span className="text-fg tnum">{filteredCount}</span>{' '}
            {filteredCount === 1 ? 'item' : 'items'}
            {selectedSprint ? <> · {selectedSprint.name}</> : <> · all sprints</>}
          </>
        }
        actions={
          <div className="flex items-center gap-1.5">
            <SegButton active={selectedId === null} onClick={() => setSelection(null)} label="All" />
            {sprints.map((s) => (
              <SegButton
                key={s.id}
                active={selectedId === s.id}
                onClick={() => setSelection(s.id)}
                label={s.name}
                hint={s.status === 'active' ? 'live' : undefined}
              />
            ))}
          </div>
        }
      />
      <div className="min-h-0 flex-1">
        <KanbanBoard sprintId={selectedId} />
      </div>
    </div>
  );
}

function SegButton({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint?: string;
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
      {hint ? (
        <span className={['text-[9px] uppercase tracking-wider', active ? 'text-violet-bright' : 'text-fg-3'].join(' ')}>
          {hint}
        </span>
      ) : null}
    </button>
  );
}
