import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWSClient } from './ws';

type Handler = (ev: MessageEvent<string> | Event) => void;

/** Minimal WebSocket double that lets tests control open/message/close. */
class FakeWebSocket {
  public listeners: Record<string, Handler[]> = {};
  public readyState = 0;
  public close = vi.fn(() => {
    this.readyState = 3;
    this.dispatch('close', new Event('close'));
  });
  constructor(public url: string) {
    // default: stay pending until dispatched
  }
  addEventListener(name: string, cb: Handler) {
    (this.listeners[name] ??= []).push(cb);
  }
  // Helpers used by tests
  dispatch(name: string, ev: Event | MessageEvent<string>) {
    for (const l of this.listeners[name] ?? []) l(ev);
  }
  open() {
    this.readyState = 1;
    this.dispatch('open', new Event('open'));
  }
  emit(data: unknown) {
    this.dispatch('message', new MessageEvent('message', { data: JSON.stringify(data) }));
  }
  emitRaw(data: string) {
    this.dispatch('message', new MessageEvent('message', { data }));
  }
  errorAndClose() {
    this.dispatch('error', new Event('error'));
    this.close();
  }
}

describe('createWSClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses valid UIEvent messages and ignores invalid ones', () => {
    const sockets: FakeWebSocket[] = [];
    const client = createWSClient({
      url: 'ws://test',
      factory: (u) => {
        const s = new FakeWebSocket(u);
        sockets.push(s);
        return s as unknown as WebSocket;
      },
    });

    const received: unknown[] = [];
    client.subscribe((e) => received.push(e));
    const sock = sockets[0]!;
    sock.open();

    // valid event
    const validEvent = {
      type: 'agent.status' as const,
      agentId: '11111111-1111-4111-8111-111111111111',
      status: 'working',
      at: new Date().toISOString(),
    };
    sock.emit(validEvent);

    // invalid (missing fields)
    sock.emit({ type: 'agent.status' });

    // malformed JSON
    sock.emitRaw('not json');

    expect(received).toHaveLength(1);
    expect((received[0] as { type: string }).type).toBe('agent.status');

    client.close();
  });

  it('reports connection status changes', () => {
    const sockets: FakeWebSocket[] = [];
    const client = createWSClient({
      url: 'ws://test',
      factory: (u) => {
        const s = new FakeWebSocket(u);
        sockets.push(s);
        return s as unknown as WebSocket;
      },
    });

    const seen: string[] = [];
    client.onStatus((s) => seen.push(s));

    sockets[0]!.open();
    expect(seen).toContain('connecting');
    expect(seen).toContain('open');

    sockets[0]!.close();
    expect(seen).toContain('closed');

    client.close();
  });

  it('reconnects with backoff after close', () => {
    const sockets: FakeWebSocket[] = [];
    const client = createWSClient({
      url: 'ws://test',
      factory: (u) => {
        const s = new FakeWebSocket(u);
        sockets.push(s);
        return s as unknown as WebSocket;
      },
      maxBackoffMs: 10_000,
    });

    sockets[0]!.open();
    expect(sockets).toHaveLength(1);

    sockets[0]!.close();
    // First backoff = 500ms
    vi.advanceTimersByTime(600);
    expect(sockets.length).toBe(2);

    sockets[1]!.close();
    // Second backoff = 1000ms
    vi.advanceTimersByTime(1200);
    expect(sockets.length).toBe(3);

    client.close();
  });

  it('stops reconnecting after close() is called by user', () => {
    const sockets: FakeWebSocket[] = [];
    const client = createWSClient({
      url: 'ws://test',
      factory: (u) => {
        const s = new FakeWebSocket(u);
        sockets.push(s);
        return s as unknown as WebSocket;
      },
    });
    sockets[0]!.open();
    client.close();
    vi.advanceTimersByTime(60_000);
    expect(sockets.length).toBe(1);
  });
});
