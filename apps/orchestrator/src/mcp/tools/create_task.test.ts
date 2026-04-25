import { describe, it, expect, vi, beforeEach } from 'vitest';

interface BagCreate {
  insertedTasks: unknown[];
  lookupAgentResult: unknown[];
  enqueueCalls: string[];
  events: unknown[];
}
const G = globalThis as unknown as { __createTaskTest: BagCreate };
G.__createTaskTest = {
  insertedTasks: [],
  lookupAgentResult: [],
  enqueueCalls: [],
  events: [],
};

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: (name: string, description: string, schema: unknown, handler: unknown) => ({
    name,
    description,
    schema,
    handler,
  }),
}));

vi.mock('../../db/client.js', () => ({
  db: {
    insert: () => ({
      values: (v: unknown) => ({
        returning: async () => {
          (globalThis as unknown as { __createTaskTest: BagCreate }).__createTaskTest.insertedTasks.push(v);
          return [
            {
              id: 'taskaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
              title: (v as { title?: string }).title ?? 'untitled',
              status: (v as { status?: string }).status ?? 'backlog',
              ...((v as object) ?? {}),
            },
          ];
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () =>
            (globalThis as unknown as { __createTaskTest: BagCreate }).__createTaskTest.lookupAgentResult,
        }),
      }),
    }),
    query: { agents: { findMany: async () => [] } },
  },
}));

vi.mock('../../redis/streams.js', () => ({
  enqueueDispatch: async (id: string) => {
    (globalThis as unknown as { __createTaskTest: BagCreate }).__createTaskTest.enqueueCalls.push(id);
    return 'stream-id';
  },
}));

vi.mock('../../events/bus.js', () => ({
  eventBus: {
    emit: (e: unknown) => {
      (globalThis as unknown as { __createTaskTest: BagCreate }).__createTaskTest.events.push(e);
      return Promise.resolve(1);
    },
  },
}));

vi.mock('../../logger.js', () => ({
  logger: { info: () => {}, debug: () => {}, error: () => {}, warn: () => {} },
}));

import { createTaskTool } from './create_task.js';

describe('create_task tool', () => {
  const state = G.__createTaskTest;

  beforeEach(() => {
    state.insertedTasks.length = 0;
    state.enqueueCalls.length = 0;
    state.events.length = 0;
    state.lookupAgentResult = [];
  });

  it('creates a task with an assignee and wakes them', async () => {
    state.lookupAgentResult = [
      { id: 'bbbb0000-0000-0000-0000-000000000000', name: 'bruno-backend' },
    ];

    const t = createTaskTool('cccc0000-0000-0000-0000-000000000000') as {
      handler: (a: Record<string, unknown>) => Promise<{ content: { text: string }[] }>;
    };
    const result = await t.handler({
      title: 'Add /health endpoint',
      description: 'Add a basic health check',
      assignee: 'bruno-backend',
      priority: 2,
    });

    expect(result.content[0]?.text).toMatch(/Created task/);
    // Two inserts now: the task row + the assignment message that wakes the
    // assignee. Filter to the task-shaped row.
    const taskRows = state.insertedTasks.filter(
      (r): r is { title: string; assigneeId?: string } =>
        typeof (r as { title?: unknown }).title === 'string',
    );
    expect(taskRows).toHaveLength(1);
    expect((taskRows[0] as { assigneeId: string }).assigneeId).toBe(
      'bbbb0000-0000-0000-0000-000000000000',
    );
    expect(state.enqueueCalls).toEqual(['bbbb0000-0000-0000-0000-000000000000']);
    expect((state.events[0] as { type: string }).type).toBe('task.created');
  });

  it('creates a task without an assignee', async () => {
    const t = createTaskTool('cccc0000-0000-0000-0000-000000000000') as {
      handler: (a: Record<string, unknown>) => Promise<{ content: { text: string }[] }>;
    };
    const result = await t.handler({ title: 'No assignee task' });
    expect(result.content[0]?.text).toMatch(/Created task/);
    expect(state.insertedTasks).toHaveLength(1);
    expect(state.enqueueCalls).toHaveLength(0);
  });

  it('errors when assignee not found', async () => {
    state.lookupAgentResult = [];
    const t = createTaskTool('cccc0000-0000-0000-0000-000000000000') as {
      handler: (a: Record<string, unknown>) => Promise<{ content: { text: string }[] }>;
    };
    const result = await t.handler({ title: 'Nope', assignee: 'ghost' });
    expect(result.content[0]?.text).toMatch(/not found/);
    expect(state.insertedTasks).toHaveLength(0);
  });
});
