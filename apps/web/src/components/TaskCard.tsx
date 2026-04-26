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

/**
 * Polish-wave priority palette (957a6bce, uma-uiux spec).
 *
 * Two-tone: text in full saturation, bg at ~12% (alpha on canvas — dark-mode
 * aware via the existing token system, equivalent intent to spec's
 * `color-mix(in srgb, accent 12%, white)` on the light canvas). No border —
 * "much quieter when several pills appear in one column".
 */
const PRIORITY: Record<number, { label: string; className: string }> = {
  1: { label: 'P1', className: 'task-pill text-err bg-err/[0.12]' },
  2: { label: 'P2', className: 'task-pill text-warn bg-warn/[0.12]' },
  3: { label: 'P3', className: 'task-pill text-fg-2 bg-sheen/[0.06]' },
  4: { label: 'P4', className: 'task-pill text-fg-3 bg-sheen/[0.04]' },
  5: { label: 'P5', className: 'task-pill text-fg-3 bg-sheen/[0.04]' },
};

export function TaskCard({ task, assignee, draggable = true, onOpen }: Props) {
  const sortable = useSortable({ id: task.id, disabled: !draggable });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable;

  const priority = PRIORITY[task.priority] ?? PRIORITY[3]!;
  const shortId = task.id.slice(0, 8);
  const interactive = !!onOpen;

  // Track down vs drag so a click without movement opens the detail dialog.
  // dnd-kit's pointer sensor uses activationConstraint:{distance:4}, so any
  // movement under 4px is treated as a click, not a drag.
  function onClick(e: React.MouseEvent) {
    if (isDragging) return;
    if (!onOpen) return;
    e.stopPropagation();
    onOpen(task);
  }

  // Keyboard activation: Enter / Space opens the detail dialog. Lets the
  // card be navigable by keyboard alongside dnd-kit's existing keyboard
  // sensor (which handles drag).
  function onKeyDown(e: React.KeyboardEvent) {
    if (!onOpen || isDragging) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen(task);
    }
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
      onKeyDown={interactive ? onKeyDown : undefined}
      tabIndex={interactive ? 0 : -1}
      role={interactive ? 'button' : undefined}
      aria-label={interactive ? `Open task: ${task.title}` : undefined}
      data-testid={`task-card-${task.id}`}
      className="task-card glass-soft group cursor-grab select-none p-4 text-left active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        {/* Title — 15px / 600 / fg (token = #1D1D1F in light mode, spec hex). */}
        <h4 className="line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight text-fg">
          {task.title}
        </h4>
        <span className={priority.className}>{priority.label}</span>
      </div>

      {/* Metadata block — 13px / 400 / fg-3. 8pt rhythm: each row is mt-2. */}
      {task.description ? (
        <p className="mt-2 line-clamp-2 text-[13px] font-normal leading-relaxed text-fg-3">
          {task.description}
        </p>
      ) : null}

      {task.branch || task.prUrl ? (
        <div className="mt-2 flex items-center gap-1.5 text-[11px]">
          {task.branch ? (
            <span className="task-pill font-mono text-fg-3 bg-sheen/[0.04] tnum" title={task.branch}>
              ⎇ {task.branch.split('/').pop()}
            </span>
          ) : null}
          {task.prUrl ? (
            <a
              href={task.prUrl}
              target="_blank"
              rel="noreferrer"
              className="task-pill text-ok bg-ok/[0.12]"
              onClick={(e) => e.stopPropagation()}
            >
              PR #{task.prNumber ?? '?'} ↗
            </a>
          ) : null}
        </div>
      ) : null}

      {/* Bottom row: assignee left, monospace task id far-right. */}
      <div className="mt-2 flex items-center justify-between">
        {assignee ? (
          <span className="flex items-center gap-1.5">
            <AgentAvatar agent={assignee} size="sm" showStatus />
            <span className="text-[13px] font-normal text-fg-3">{assignee.name}</span>
          </span>
        ) : (
          <span className="text-[13px] font-normal italic text-fg-3">unassigned</span>
        )}
        <span className="font-mono text-[11px] text-fg-3 tnum">{shortId}</span>
      </div>
    </article>
  );
}

/**
 * 3-line shimmer used while task data is loading. Pair with a 200ms+ delay
 * at the call site to prevent flash on fast fetches.
 */
export function TaskCardSkeleton() {
  return (
    <article
      aria-busy={true}
      aria-label="Loading task"
      className="task-card glass-soft p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="block h-3 w-2/3 animate-pulse rounded bg-sheen/[0.06]" />
        <span className="block h-3 w-6 shrink-0 animate-pulse rounded bg-sheen/[0.06]" />
      </div>
      <span className="mt-2 block h-3 w-full animate-pulse rounded bg-sheen/[0.04]" />
      <span className="mt-2 block h-3 w-1/2 animate-pulse rounded bg-sheen/[0.04]" />
    </article>
  );
}
