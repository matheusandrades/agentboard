import { describe, it, expect, vi, beforeEach } from 'vitest';

/* -------------------------- shared state (via globalThis) --------------------- */
/* vi.mock factories are hoisted. To share mutable state safely we stash it on
   globalThis — the only identifier the hoisted factory can reach. */
interface BagSend {
  insertedMessages: unknown[];
  lookupAgentResult: unknown[];
  enqueueCalls: string[];
  events: unknown[];
}
const G = globalThis as unknown as { __sendMessageTest: BagSend };
G.__sendMessageTest = {
  insertedMessages: [],
  lookupAgentResult: [],
  enqueueCalls: [],
  events: [],
};

/* -------------------------- module mocks --------------------------- */
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
          (globalThis as unknown as { __sendMessageTest: BagSend }).__sendMessageTest.insertedMessages.push(v);
          return [{ id: '11111111-1111-1111-1111-111111111111', ...((v as object) ?? {}) }];
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () =>
            (globalThis as unknown as { __sendMessageTest: BagSend }).__sendMessageTest
              .lookupAgentResult,
        }),
      }),
    }),
    query: { agents: { findMany: async () => [] } },
  },
}));

vi.mock('../../redis/streams.js', () => ({
  enqueueDispatch: async (id: string) => {
    (globalThis as unknown as { __sendMessageTest: BagSend }).__sendMessageTest.enqueueCalls.push(id);
    return 'stream-id-1';
  },
}));

vi.mock('../../events/bus.js', () => ({
  eventBus: {
    emit: (e: unknown) => {
      (globalThis as unknown as { __sendMessageTest: BagSend }).__sendMessageTest.events.push(e);
      return Promise.resolve(1);
    },
  },
}));

vi.mock('../../logger.js', () => ({
  logger: { info: () => {}, debug: () => {}, error: () => {}, warn: () => {} },
}));

/* -------------------------- actual import -------------------------- */
import { sendMessageTool } from './send_message.js';

describe('send_message tool', () => {
  const state = G.__sendMessageTest;

  beforeEach(() => {
    state.insertedMessages.length = 0;
    state.enqueueCalls.length = 0;
    state.events.length = 0;
    state.lookupAgentResult = [];
  });

  it('inserts a message, enqueues dispatch, emits event', async () => {
    state.lookupAgentResult = [
      {
        id: '22222222-2222-2222-2222-222222222222',
        name: 'bruno-backend',
        role: 'backend',
      },
    ];

    const toolObj = sendMessageTool('33333333-3333-3333-3333-333333333333') as {
      handler: (args: Record<string, unknown>) => Promise<{ content: { text: string }[] }>;
    };
    const result = await toolObj.handler({
      to: 'bruno-backend',
      type: 'assignment',
      subject: 'Build endpoint',
      content: 'Please build POST /foo',
    });

    expect(result.content[0]?.text).toContain('Sent assignment');
    expect(state.insertedMessages).toHaveLength(1);
    expect(state.enqueueCalls).toEqual(['22222222-2222-2222-2222-222222222222']);
    expect(state.events).toHaveLength(1);
    expect((state.events[0] as { type: string }).type).toBe('message.sent');
  });

  it('returns error when recipient not found', async () => {
    state.lookupAgentResult = [];
    const toolObj = sendMessageTool('aaaa2222-2222-2222-2222-222222222222') as {
      handler: (args: Record<string, unknown>) => Promise<{ content: { text: string }[] }>;
    };
    const result = await toolObj.handler({
      to: 'does-not-exist',
      type: 'status',
      subject: 'x',
      content: 'y',
    });
    expect(result.content[0]?.text).toMatch(/not found/);
    expect(state.insertedMessages).toHaveLength(0);
    expect(state.enqueueCalls).toHaveLength(0);
  });
});
