import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Agent, Task, TaskStatus } from '@/lib/types';
import { TaskCard } from './TaskCard';

interface Props {
  status: TaskStatus;
  title: string;
  tasks: Task[];
  agents: Agent[];
  onOpenTask?: (task: Task) => void;
}

const STATUS_ACCENT: Record<TaskStatus, string> = {
  backlog: 'bg-fg-3',
  todo: 'bg-[#8fcfff]',
  in_progress: 'bg-warn',
  review: 'bg-violet',
  done: 'bg-ok',
};

export function KanbanColumn({ status, title, tasks, agents, onOpenTask }: Props) {
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
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
          {tasks.length === 0 ? (
            <div className="flex items-center justify-center rounded-xl border border-dashed border-hairline py-10 text-center text-[11px] text-fg-3">
              Nothing here
            </div>
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
