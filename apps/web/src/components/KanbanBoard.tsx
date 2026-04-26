import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { Task, TaskStatus } from '@/lib/types';
import { useBoardStore } from '@/lib/store';
import * as api from '@/lib/api';
import { KanbanColumn } from './KanbanColumn';
import { TaskCard } from './TaskCard';
import { TaskDetailDialog } from './TaskDetailDialog';

const COLUMNS: { status: TaskStatus; title: string }[] = [
  { status: 'backlog', title: 'Backlog' },
  { status: 'todo', title: 'To do' },
  { status: 'in_progress', title: 'In progress' },
  { status: 'review', title: 'Review' },
  { status: 'done', title: 'Done' },
];

interface Props {
  sprintId?: string | null;
}

export function KanbanBoard({ sprintId }: Props) {
  const tasks = useBoardStore((s) => s.tasks);
  const agents = useBoardStore((s) => s.agents);
  const storeLoaded = useBoardStore((s) => s.loaded);
  const setTasks = useBoardStore((s) => s.setTasks);

  // 200ms flash-prevent (957a6bce, item 5): skeleton only renders if the
  // store hasn't loaded after 200ms. Fast fetches don't flicker.
  const [showSkeleton, setShowSkeleton] = useState(false);
  useEffect(() => {
    if (storeLoaded) {
      setShowSkeleton(false);
      return;
    }
    const t = setTimeout(() => setShowSkeleton(true), 200);
    return () => clearTimeout(t);
  }, [storeLoaded]);

  const filtered = useMemo(
    () => (sprintId ? tasks.filter((t) => t.sprintId === sprintId) : tasks),
    [tasks, sprintId],
  );

  const grouped = useMemo(() => groupByStatus(filtered), [filtered]);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const openTask = openTaskId ? tasks.find((t) => t.id === openTaskId) ?? null : null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  function onDragStart(ev: DragStartEvent) {
    const t = tasks.find((x) => x.id === ev.active.id);
    setActiveTask(t ?? null);
  }

  async function onDragEnd(ev: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = ev;
    if (!over) return;
    const task = tasks.find((x) => x.id === active.id);
    if (!task) return;
    const nextStatus = resolveDropStatus(String(over.id), tasks);
    if (!nextStatus || nextStatus === task.status) return;
    const previous = tasks;
    setTasks(tasks.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)));
    try {
      const updated = await api.updateTask(task.id, { status: nextStatus });
      setTasks(useBoardStore.getState().tasks.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err) {
      setTasks(previous);
      // eslint-disable-next-line no-console
      console.error('updateTask failed', err);
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div
        className="grid h-full min-h-0 gap-3 px-6 py-5"
        style={{ gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(0, 1fr))` }}
      >
        {COLUMNS.map((c) => (
          <KanbanColumn
            key={c.status}
            status={c.status}
            title={c.title}
            tasks={grouped[c.status]}
            agents={agents}
            loading={showSkeleton}
            onOpenTask={(t) => setOpenTaskId(t.id)}
          />
        ))}
      </div>
      {openTask ? (
        <TaskDetailDialog task={openTask} onClose={() => setOpenTaskId(null)} />
      ) : null}
      <DragOverlay>
        {activeTask ? (
          <TaskCard
            task={activeTask}
            assignee={activeTask.assigneeId ? agentById.get(activeTask.assigneeId) : null}
            draggable={false}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function groupByStatus(tasks: Task[]): Record<TaskStatus, Task[]> {
  const base: Record<TaskStatus, Task[]> = {
    backlog: [],
    todo: [],
    in_progress: [],
    review: [],
    done: [],
  };
  for (const t of tasks) base[t.status].push(t);
  return base;
}

function resolveDropStatus(overId: string, tasks: Task[]): TaskStatus | null {
  if (overId.startsWith('column:')) return overId.slice('column:'.length) as TaskStatus;
  const other = tasks.find((t) => t.id === overId);
  return other ? other.status : null;
}

export const __testOnly = { groupByStatus, resolveDropStatus };
