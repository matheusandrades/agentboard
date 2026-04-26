/**
 * ActivityPanel — prominent live feed of the last N agent events.
 *
 * Reads initial state from the board store (which loads on app boot via
 * loadAll()), then polls /api/activity every 5s as a websocket-fallback
 * keep-fresh. Renders task status changes, messages, agent status flips,
 * tool calls, commits, approvals — every event type ActivityItem knows.
 *
 * a11y: heading + role="feed" + aria-busy on skeleton + aria-live="polite"
 * for incoming items.
 *
 * Mobile (≥360px): single column, no horizontal scroll. The avatar/timestamp
 * columns of ActivityItem already collapse cleanly at small widths.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as api from '@/lib/api';
import { useBoardStore } from '@/lib/store';
import type { ActivityItem as ActivityItemType } from '@/lib/types';
import { ActivityItem } from './ActivityItem';
import { DEMO_ACTIVITY } from './ActivityPanel.demo';

interface Props {
  /** Max items to show. Default 30 per spec. */
  limit?: number;
  /** Polling interval in ms. Default 5_000. Set to 0 to disable. */
  pollMs?: number;
}

type LoadState = 'initial' | 'ready' | 'error';

// Preview/demo mode (set at build time via VITE_DEMO=true). Lets QA + Uma
// open the launch_preview URL and see a populated feed without booting the
// orchestrator + postgres stack. No effect in production builds.
const DEMO = (import.meta.env.VITE_DEMO as string | undefined) === 'true';

export function ActivityPanel({ limit = 30, pollMs = 5_000 }: Props) {
  const agents = useBoardStore((s) => s.agents);
  const storeActivity = useBoardStore((s) => s.activity);
  const storeLoaded = useBoardStore((s) => s.loaded);

  // Local state for polled feed. Seed from store so first paint is instant
  // when the store has already loaded.
  const [items, setItems] = useState<ActivityItemType[]>(() =>
    DEMO ? DEMO_ACTIVITY.slice(0, limit) : storeActivity.slice(0, limit),
  );
  const [state, setState] = useState<LoadState>(
    DEMO || storeLoaded ? 'ready' : 'initial',
  );
  const [error, setError] = useState<string | null>(null);

  // Keep local items in sync with the WS-driven store between polls so the
  // list never feels stale. The store may already have fresher data than
  // the last poll did.
  useEffect(() => {
    if (DEMO) return; // demo mode is fully self-contained
    setItems(storeActivity.slice(0, limit));
    if (storeLoaded && state === 'initial') setState('ready');
  }, [storeActivity, storeLoaded, limit, state]);

  // 5s polling fallback — covers WS disconnects + first-paint when the
  // store hasn't loaded yet.
  const cancelled = useRef(false);
  useEffect(() => {
    if (DEMO) return; // demo seed is the source of truth in preview builds
    cancelled.current = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const fetchOnce = async () => {
      try {
        const next = await api.listActivity(limit);
        if (cancelled.current) return;
        setItems(next);
        setState('ready');
        setError(null);
      } catch (err) {
        if (cancelled.current) return;
        const msg = err instanceof Error ? err.message : 'Failed to load activity';
        setError(msg);
        if (state === 'initial') setState('error');
      }
    };

    void fetchOnce();
    if (pollMs > 0) timer = setInterval(fetchOnce, pollMs);

    return () => {
      cancelled.current = true;
      if (timer) clearInterval(timer);
    };
    // pollMs/limit are stable; we deliberately don't depend on `state`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit, pollMs]);

  // Index agents by id once for cheap lookups inside the map.
  const agentById = useMemo(() => {
    const m = new Map<string, (typeof agents)[number]>();
    for (const a of agents) m.set(a.id, a);
    return m;
  }, [agents]);

  return (
    <section
      aria-labelledby="activity-panel-heading"
      className="glass overflow-hidden"
    >
      <header className="flex items-center justify-between border-b border-hairline px-4 py-2.5 sm:px-6">
        <div className="flex items-baseline gap-2">
          <h2
            id="activity-panel-heading"
            className="eyebrow"
          >
            Activity
          </h2>
          {state === 'ready' && items.length > 0 ? (
            <span
              aria-label={`${items.length} recent events`}
              className="font-mono text-[10px] text-fg-3 tnum"
            >
              {items.length}
            </span>
          ) : null}
        </div>
        {error && state === 'ready' ? (
          <span
            role="status"
            className="font-mono text-[10px] text-warn"
            title={error}
          >
            stale · retrying
          </span>
        ) : null}
      </header>

      {state === 'initial' ? (
        <SkeletonList />
      ) : state === 'error' ? (
        <ErrorState message={error ?? 'Failed to load activity'} />
      ) : items.length === 0 ? (
        <EmptyState />
      ) : (
        <ul
          role="feed"
          aria-busy={false}
          aria-live="polite"
          className="max-h-[420px] divide-y divide-hairline overflow-y-auto"
        >
          {items.map((item) => (
            <ActivityItem
              key={item.id}
              item={item}
              agent={agentById.get(item.agentId ?? '') ?? null}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/* ───────────────── states ───────────────── */

function SkeletonList() {
  return (
    <ul
      aria-busy={true}
      aria-label="Loading activity"
      className="divide-y divide-hairline"
    >
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="flex items-start gap-3 px-6 py-3"
        >
          <span className="h-6 w-6 shrink-0 rounded-full bg-sheen/[0.06] animate-pulse" />
          <div className="min-w-0 flex-1 space-y-2">
            <span className="block h-3 w-1/3 rounded bg-sheen/[0.06] animate-pulse" />
            <span className="block h-3 w-2/3 rounded bg-sheen/[0.04] animate-pulse" />
          </div>
          <span className="h-3 w-10 shrink-0 rounded bg-sheen/[0.04] animate-pulse" />
        </li>
      ))}
    </ul>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <p className="text-[13px] text-fg-2">No activity yet — assign a task to wake an agent.</p>
      <p className="text-[11px] text-fg-3">
        Events appear here as agents work: status changes, messages, commits, approvals.
      </p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center"
    >
      <p className="text-[13px] text-err">Couldn&rsquo;t load activity.</p>
      <p className="font-mono text-[11px] text-fg-3">{message}</p>
    </div>
  );
}
