import { describe, it, expect, vi, beforeEach } from 'vitest';

/* --------------------------- mocks --------------------------- */

// We won't import the SDK but we do need to satisfy the runner's import.
const sdkCalls: Array<{ prompt: string; options: Record<string, unknown> }> = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (input: { prompt: string; options: Record<string, unknown> }) => {
    sdkCalls.push(input);
    return (async function* () {
      yield { type: 'assistant', text: 'acknowledged' };
      yield { type: 'result', session_id: 'session-new-123' };
    })();
  },
  createSdkMcpServer: (cfg: unknown) => ({ __mcp: cfg }),
  tool: (n: string, d: string, s: unknown, h: unknown) => ({
    name: n,
    description: d,
    schema: s,
    handler: h,
  }),
}));

// Shared state accessed by mocks.
const agentUpdates: Array<Record<string, unknown>> = [];
const mockUnread = [
  {
    id: 'msg-1',
    fromAgentId: null,
    toAgentId: 'agent-1',
    type: 'assignment',
    subject: 'Hi',
    content: 'hello there',
    readAt: null,
    createdAt: new Date().toISOString(),
  },
];

// `vi.mock` factories must be self-contained (Vitest hoists them). We stash
// mutable state on globalThis so the factory can reach it safely.
const G = globalThis as unknown as {
  __runnerTest: {
    selectCallIndex: number;
    unread: typeof mockUnread;
    agentUpdates: typeof agentUpdates;
  };
};
G.__runnerTest = { selectCallIndex: 0, unread: mockUnread, agentUpdates };

vi.mock('../db/client.js', () => {
  // Promise-like thenable that also exposes the chainable methods drizzle-style.
  function thenable<T>(result: T, extra: Record<string, unknown> = {}) {
    return {
      ...extra,
      then(onFulfilled?: (v: T) => unknown) {
        return Promise.resolve(result).then(onFulfilled);
      },
      catch: Promise.resolve(result).catch.bind(Promise.resolve(result)),
      returning: async () => [result],
    };
  }
  return {
    db: {
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: () => {
            (
              globalThis as unknown as { __runnerTest: { agentUpdates: Record<string, unknown>[] } }
            ).__runnerTest.agentUpdates.push(patch);
            return thenable(null);
          },
        }),
      }),
      insert: () => ({
        values: () => ({ returning: async () => [] }),
      }),
      select: () => ({
        from: () => ({
          where: (_c: unknown) => {
            const state = (
              globalThis as unknown as { __runnerTest: { selectCallIndex: number; unread: unknown[] } }
            ).__runnerTest;
            state.selectCallIndex += 1;
            if (state.selectCallIndex === 1) {
              return {
                orderBy: () => ({ limit: async () => state.unread }),
              };
            }
            return { limit: async () => [] };
          },
        }),
      }),
      query: { agents: { findMany: async () => [] } },
    },
  };
});

vi.mock('./persona.js', () => ({
  loadPersona: async () => 'You are a test agent.',
}));

vi.mock('../mcp/server.js', () => ({
  buildMcpServer: (id: string) => ({ __id: id }),
  AGENT_ALLOWED_TOOLS: ['Read'],
}));

vi.mock('../hooks/activity.js', () => ({
  activityHook: (_id: string) => () => ({ continue: true }),
}));
vi.mock('../hooks/session.js', () => ({
  sessionHook: (_id: string) => () => ({ continue: true }),
}));

const events: unknown[] = [];
(globalThis as unknown as { __runnerTestEvents: unknown[] }).__runnerTestEvents = events;
vi.mock('../events/bus.js', () => ({
  eventBus: {
    emit: (e: unknown) => {
      (globalThis as unknown as { __runnerTestEvents: unknown[] }).__runnerTestEvents.push(e);
      return Promise.resolve(1);
    },
  },
}));

vi.mock('../config.js', () => ({
  env: { AGENT_MAX_TURNS: 5 },
}));

vi.mock('../logger.js', () => ({
  logger: { info: () => {}, debug: () => {}, error: () => {}, warn: () => {} },
}));

/* ---------------------------- tests --------------------------- */

import { runAgentTurn, formatInboxAsPrompt } from './runner.js';

describe('formatInboxAsPrompt', () => {
  it('produces a readable prompt for the inbox', () => {
    const prompt = formatInboxAsPrompt(
      [
        {
          id: 'm1',
          fromAgentId: 'a1',
          toAgentId: 'a2',
          type: 'assignment',
          subject: 'Build X',
          content: 'Please build X',
          taskId: null,
          threadId: null,
          createdAt: new Date() as unknown as string,
          readAt: null,
          deliveredAt: null,
          metadata: null,
        } as never,
      ],
      new Map([['a1', 'alice-pm']]),
    );
    expect(prompt).toContain('alice-pm');
    expect(prompt).toContain('Build X');
    expect(prompt).toContain('Please build X');
  });
});

describe('runAgentTurn', () => {
  beforeEach(() => {
    sdkCalls.length = 0;
    agentUpdates.length = 0;
    events.length = 0;
    (globalThis as unknown as { __runnerTest: { selectCallIndex: number } }).__runnerTest.selectCallIndex = 0;
  });

  it('calls SDK with resume=sessionId and persists new session_id', async () => {
    await runAgentTurn('agent-1', {
      loadAgent: async () => ({
        id: 'agent-1',
        name: 'alice-pm',
        role: 'pm',
        personaPath: '/nowhere/pm.md',
        sessionId: 'prev-session-xyz',
        status: 'idle',
        worktreePath: '/tmp/work',
        createdAt: new Date() as unknown as Date,
      }),
    });

    // SDK was called exactly once.
    expect(sdkCalls).toHaveLength(1);
    const firstCall = sdkCalls[0]!;
    expect(firstCall.options.resume).toBe('prev-session-xyz');
    expect(firstCall.options.systemPrompt).toBe('You are a test agent.');

    // New session id was persisted.
    const sessionWrite = agentUpdates.find((u) => 'sessionId' in u);
    expect(sessionWrite).toBeDefined();
    expect((sessionWrite as { sessionId: string }).sessionId).toBe('session-new-123');

    // Two status events were emitted (working then idle).
    const statusEvents = events.filter((e) => (e as { type: string }).type === 'agent.status');
    expect(statusEvents).toHaveLength(2);
    expect((statusEvents[0] as { status: string }).status).toBe('working');
    expect((statusEvents[1] as { status: string }).status).toBe('idle');
  });

  it('no-ops when the agent is not found', async () => {
    await runAgentTurn('ghost', { loadAgent: async () => null });
    expect(sdkCalls).toHaveLength(0);
    expect(agentUpdates).toHaveLength(0);
  });
});
