import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { KanbanBoard } from './KanbanBoard';
import { useBoardStore } from '@/lib/store';
import type { Agent, Task } from '@/lib/types';

const agent: Agent = {
  id: '22222222-2222-2222-2222-222222222222',
  name: 'lucas-frontend',
  role: 'frontend',
  personaPath: 'agents/frontend.md',
  sessionId: null,
  status: 'idle',
  worktreePath: null,
  createdAt: new Date().toISOString(),
};

function task(overrides: Partial<Task>): Task {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    sprintId: null,
    title: overrides.title ?? 'Task',
    description: null,
    status: overrides.status ?? 'todo',
    assigneeId: overrides.assigneeId ?? agent.id,
    createdBy: null,
    priority: overrides.priority ?? 3,
    parentId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Task;
}

describe('<KanbanBoard>', () => {
  beforeEach(() => {
    useBoardStore.setState({
      agents: [agent],
      tasks: [
        task({ title: 'Backlog item', status: 'backlog' }),
        task({ title: 'Todo item', status: 'todo' }),
        task({ title: 'Doing item', status: 'in_progress' }),
        task({ title: 'Review item', status: 'review' }),
        task({ title: 'Done item', status: 'done' }),
      ],
      loaded: true,
    });
  });

  it('renders all five columns', () => {
    render(<KanbanBoard />);
    for (const s of ['backlog', 'todo', 'in_progress', 'review', 'done']) {
      expect(screen.getByTestId(`column-${s}`)).toBeInTheDocument();
    }
  });

  it('places each task in the correct column', () => {
    render(<KanbanBoard />);
    expect(
      within(screen.getByTestId('column-backlog')).getByText('Backlog item'),
    ).toBeInTheDocument();
    expect(within(screen.getByTestId('column-todo')).getByText('Todo item')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('column-in_progress')).getByText('Doing item'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('column-review')).getByText('Review item'),
    ).toBeInTheDocument();
    expect(within(screen.getByTestId('column-done')).getByText('Done item')).toBeInTheDocument();
  });
});
