import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Agent, Task, TaskStatus } from '@/lib/types';
import { TaskCard, TaskCardSkeleton } from './TaskCard';

interface Props {
  status: TaskStatus;
  title: string;
  tasks: Task[];
  agents: Agent[];
  /**
   * Show 3 task-card skeletons instead of tasks. Pair with a 200ms+ delay
   * at the call site to prevent flash on fast fetches (957a6bce, item 5).
   */
  loading?: boolean;
  onOpenTask?: (task: Task) => void;
}

const STATUS_ACCENT: Record<TaskStatus, string> = {
  backlog: 'bg-fg-3',
  todo: 'bg-[#8fcfff]',
  in_progress: 'bg-warn',
  review: 'bg-violet',
  done: 'bg-ok',
};

export function KanbanColumn({ status, title, tasks, agents, loading, onOpenTask }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${status}` });
  const agentById = new Map(agents.map((a) => [a.id, a]));

  return (
    <section
      ref={setNodeRef}
      data-testid={`column-${status}`}
      className={[
        'flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-sheen/[0.015] p-3 transition duration-200 backdrop-blur-xl',
        isOver ? 'border-violet/40 bg-violet-soft' : 'border-hairline',
      ].join(' ')}
    >
      <header className="flex items-center justify-between px-1 pb-3">
        <div className="flex items-center gap-2">
          <span className={['h-2 w-2 rounded-full', STATUS_ACCENT[status]].join(' ')} />
          <h3 className="text-[13px] font-medium tracking-tight text-fg">{title}</h3>
        </div>
        <span className="pill tnum">{tasks.length}</span>
      </header>

      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        {/* Card-to-card gap = 12px per uma's 8pt rhythm spec (957a6bce, item 2). */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
          {loading ? (
            <>
              <TaskCardSkeleton />
              <TaskCardSkeleton />
              <TaskCardSkeleton />
            </>
          ) : tasks.length === 0 ? (
            <EmptyColumn status={status} />
          ) : (
            tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                assignee={task.assigneeId ? agentById.get(task.assigneeId) : null}
                onOpen={onOpenTask}
              />
            ))
          )}
        </div>
      </SortableContext>
    </section>
  );
}

/**
 * Empty-column placeholder. Copy locked by leo-langs from the empty-states
 * audit §4.3 (PR #7, commit a3fd729):
 *   - Backlog / Todo: "No tasks yet" + "Drag a card in or chat ⌘K."
 *   - In-progress / Review / Done: "No tasks in this column" (no subhead)
 *
 * Backlog/Todo are user-actionable — they get an affordance hint. The
 * other three fill themselves from agent activity, so explaining how is
 * noise. Centered with a dashed hairline so it doesn't compete visually
 * with cards but still hints at the dropzone.
 */
function EmptyColumn({ status }: { status: TaskStatus }) {
  const copy = EMPTY_COPY[status];
  return (
    <div
      role="note"
      className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-hairline px-4 py-10 text-center"
    >
      <p className="text-[13px] font-normal text-fg-2">{copy.title}</p>
      {copy.subhead ? <p className="text-[11px] text-fg-3">{copy.subhead}</p> : null}
    </div>
  );
}

const EMPTY_COPY: Record<TaskStatus, { title: string; subhead?: string }> = {
  backlog: { title: 'No tasks yet', subhead: 'Drag a card in or chat ⌘K.' },
  todo: { title: 'No tasks yet', subhead: 'Drag a card in or chat ⌘K.' },
  in_progress: { title: 'No tasks in this column' },
  review: { title: 'No tasks in this column' },
  done: { title: 'No tasks in this column' },
};
