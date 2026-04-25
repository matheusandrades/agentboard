import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import type { ReactNode } from 'react';
import { TaskCard } from './TaskCard';
import type { Agent, Task } from '@/lib/types';

const task: Task = {
  id: '11111111-1111-1111-1111-111111111111',
  sprintId: null,
  title: 'Implement login form',
  description: 'Use the design system button.',
  status: 'todo',
  assigneeId: '22222222-2222-2222-2222-222222222222',
  createdBy: null,
  priority: 2,
  parentId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const assignee: Agent = {
  id: task.assigneeId!,
  name: 'lucas-frontend',
  role: 'frontend',
  personaPath: 'agents/frontend.md',
  sessionId: null,
  status: 'working',
  worktreePath: null,
  createdAt: new Date().toISOString(),
};

function renderWithDnd(ui: ReactNode) {
  return render(
    <DndContext>
      <SortableContext items={[task.id]}>{ui}</SortableContext>
    </DndContext>,
  );
}

describe('<TaskCard>', () => {
  it('renders the task title and assignee', () => {
    renderWithDnd(<TaskCard task={task} assignee={assignee} />);
    expect(screen.getByText('Implement login form')).toBeInTheDocument();
    expect(screen.getByText('lucas-frontend')).toBeInTheDocument();
  });

  it('shows priority badge', () => {
    renderWithDnd(<TaskCard task={task} assignee={assignee} />);
    expect(screen.getByText('P2')).toBeInTheDocument();
  });

  it('renders "unassigned" when no assignee', () => {
    renderWithDnd(<TaskCard task={{ ...task, assigneeId: null }} assignee={null} />);
    expect(screen.getByText(/unassigned/i)).toBeInTheDocument();
  });

  it('renders a truncated task id', () => {
    renderWithDnd(<TaskCard task={task} assignee={assignee} />);
    expect(screen.getByText(task.id.slice(0, 8))).toBeInTheDocument();
  });
});
