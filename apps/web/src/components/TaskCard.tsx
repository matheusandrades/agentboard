import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Agent, Task } from '@/lib/types';
import { AgentAvatar } from './AgentAvatar';

interface Props {
  task: Task;
  assignee?: Agent | null;
  draggable?: boolean;
  onOpen?: (task: Task) => void;
}

const PRIORITY: Record<number, { label: string; className: string }> = {
  1: { label: 'P1', className: 'pill pill-err' },
  2: { label: 'P2', className: 'pill pill-warn' },
  3: { label: 'P3', className: 'pill' },
  4: { label: 'P4', className: 'pill text-fg-3' },
  5: { label: 'P5', className: 'pill text-fg-3' },
};

export function TaskCard({ task, assignee, draggable = true, onOpen }: Props) {
  const sortable = useSortable({ id: task.id, disabled: !draggable });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable;

  const priority = PRIORITY[task.priority] ?? PRIORITY[3]!;
  const shortId = task.id.slice(0, 8);

  // Track down vs drag so a click without movement opens the detail dialog.
  // dnd-kit's pointer sensor uses activationConstraint:{distance:4}, so any
  // movement under 4px is treated as a click, not a drag.
  function onClick(e: React.MouseEvent) {
    if (isDragging) return;
    if (!onOpen) return;
    e.stopPropagation();
    onOpen(task);
  }

  return (
    <article
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : 1,
      }}
      {...(draggable ? attributes : {})}
      {...(draggable ? listeners : {})}
      onClick={onClick}
      data-testid={`task-card-${task.id}`}
      className="glass-soft hover-raise group cursor-grab select-none p-3 text-left active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="line-clamp-2 text-[14px] font-medium leading-snug tracking-tight text-fg">
          {task.title}
        </h4>
        <span className={priority.className}>{priority.label}</span>
      </div>

      {task.description ? (
        <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-fg-2">
          {task.description}
        </p>
      ) : null}

      {task.branch || task.prUrl ? (
        <div className="mt-2 flex items-center gap-1.5 text-[10px]">
          {task.branch ? (
            <span className="pill font-mono tnum" title={task.branch}>
              ⎇ {task.branch.split('/').pop()}
            </span>
          ) : null}
          {task.prUrl ? (
            <a
              href={task.prUrl}
              target="_blank"
              rel="noreferrer"
              className="pill pill-ok"
              onClick={(e) => e.stopPropagation()}
            >
              PR #{task.prNumber ?? '?'} ↗
            </a>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between">
        <span className="font-mono text-[10px] text-fg-3 tnum">{shortId}</span>
        {assignee ? (
          <span className="flex items-center gap-1.5">
            <AgentAvatar agent={assignee} size="sm" showStatus />
            <span className="text-[11px] text-fg-2">{assignee.name}</span>
          </span>
        ) : (
          <span className="text-[11px] italic text-fg-3">unassigned</span>
        )}
      </div>
    </article>
  );
}
