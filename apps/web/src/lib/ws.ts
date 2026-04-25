import { UIEventSchema, type UIEvent } from '@agentboard/shared';
import { WS_URL } from './env';

export type WSHandler = (event: UIEvent) => void;
export type ConnectionStatus = 'connecting' | 'open' | 'closed';
export type ConnectionListener = (status: ConnectionStatus) => void;

export interface WSClient {
  subscribe(handler: WSHandler): () => void;
  onStatus(listener: ConnectionListener): () => void;
  getStatus(): ConnectionStatus;
  close(): void;
}

interface CreateOptions {
  url?: string;
  /** Allow injecting a custom WebSocket factory (used by tests). */
  factory?: (url: string) => WebSocket;
  maxBackoffMs?: number;
  /** If true, the client does not auto-connect. Useful for tests. */
  autoConnect?: boolean;
}

/**
 * Create a reconnecting WebSocket client.
 * - parses incoming messages with UIEventSchema (drops invalid ones)
 * - exponential backoff up to `maxBackoffMs` (default 10s)
 */
export function createWSClient(options: CreateOptions = {}): WSClient {
  const url = options.url ?? WS_URL;
  const factory = options.factory ?? ((u: string) => new WebSocket(u));
  const maxBackoffMs = options.maxBackoffMs ?? 10_000;

  const handlers = new Set<WSHandler>();
  const statusListeners = new Set<ConnectionListener>();

  let socket: WebSocket | null = null;
  let status: ConnectionStatus = 'closed';
  let attempt = 0;
  let closedByUser = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function setStatus(next: ConnectionStatus) {
    if (status === next) return;
    status = next;
    for (const l of statusListeners) {
      try {
        l(status);
      } catch {
        /* ignore */
      }
    }
  }

  function scheduleReconnect() {
    if (closedByUser) return;
    const delay = Math.min(maxBackoffMs, 500 * 2 ** Math.min(attempt, 6));
    attempt += 1;
    reconnectTimer = setTimeout(connect, delay);
  }

  function connect() {
    if (closedByUser) return;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    try {
      setStatus('connecting');
      socket = factory(url);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[ws] connect threw', err);
      setStatus('closed');
      scheduleReconnect();
      return;
    }

    socket.addEventListener('open', () => {
      attempt = 0;
      setStatus('open');
    });

    socket.addEventListener('message', (ev: MessageEvent<string>) => {
      let raw: unknown;
      try {
        raw = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
      } catch {
        return;
      }
      const parsed = UIEventSchema.safeParse(raw);
      if (!parsed.success) {
        // eslint-disable-next-line no-console
        console.warn('[ws] invalid UIEvent', parsed.error);
        return;
      }
      for (const h of handlers) {
        try {
          h(parsed.data);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[ws] handler threw', err);
        }
      }
    });

    socket.addEventListener('close', () => {
      setStatus('closed');
      scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      // onclose will fire right after; just flag status
      setStatus('closed');
    });
  }

  if (options.autoConnect !== false) {
    connect();
  }

  return {
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onStatus(listener) {
      statusListeners.add(listener);
      listener(status);
      return () => statusListeners.delete(listener);
    },
    getStatus() {
      return status;
    },
    close() {
      closedByUser = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socket && socket.readyState <= 1) {
        try {
          socket.close();
        } catch {
          /* ignore */
        }
      }
      setStatus('closed');
    },
  };
}

// Singleton used by the app (lazy init to keep tests deterministic).
let singleton: WSClient | null = null;
export function getWSClient(): WSClient {
  if (!singleton) singleton = createWSClient();
  return singleton;
}

export { UIEventSchema };
export type { UIEvent };
