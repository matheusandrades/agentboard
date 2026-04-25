import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_URL = process.env.TEST_REDIS_URL;

/**
 * Optional integration test: only runs when TEST_REDIS_URL is set. If not,
 * skips cleanly so CI without Redis still passes.
 */
const d = TEST_URL ? describe : describe.skip;

d('Redis streams + locks (integration)', () => {
  let Redis: typeof import('ioredis').default;
  let client: import('ioredis').Redis;
  let streams: typeof import('./streams.js');

  beforeAll(async () => {
    // Force env for the module before import.
    process.env.REDIS_URL = TEST_URL!;
    Redis = (await import('ioredis')).default;
    client = new Redis(TEST_URL!);
    streams = await import('./streams.js');
    // Reset the test stream so we don't accumulate entries across runs.
    await client.del(streams.DISPATCH_STREAM).catch(() => {});
    await streams.ensureDispatchGroup(client);
  });

  afterAll(async () => {
    try {
      await client?.quit();
    } catch {
      /* ignore */
    }
  });

  it('enqueues and reads a dispatch entry', async () => {
    const id = await streams.enqueueDispatch('agent-xyz', {}, client);
    expect(id).toBeTruthy();

    const entries = await streams.readDispatch(
      'test-consumer',
      { blockMs: 100, count: 10 },
      client,
    );
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.agentId).toBe('agent-xyz');

    await streams.ackDispatch(entries[0]!.id, client);
  });

  it('locks are mutually exclusive', async () => {
    const key = `test-lock-${Date.now()}`;
    const t1 = await streams.acquireLock(key, 2000, client);
    expect(t1).toBeTruthy();
    const t2 = await streams.acquireLock(key, 2000, client);
    expect(t2).toBeNull();
    expect(await streams.releaseLock(key, t1!, client)).toBe(true);
    const t3 = await streams.acquireLock(key, 2000, client);
    expect(t3).toBeTruthy();
    await streams.releaseLock(key, t3!, client);
  });
});
