import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { useBoardStore } from '@/lib/store';
import { AgentAvatar } from '@/components/AgentAvatar';
import { relativeTime } from '@/lib/time';
import * as api from '@/lib/api';
import type { ReplayEvent, Task } from '@/lib/types';

export function TaskReplay() {
  const { id = '' } = useParams();
  const agents = useBoardStore((s) => s.agents);
  const [task, setTask] = useState<Task | null>(null);
  const [events, setEvents] = useState<ReplayEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    void (async () => {
      try {
        const r = await api.taskReplay(id);
        if (cancel) return;
        setTask(r.task);
        setEvents(r.events);
        setCursor(r.events.length); // start at the end (full playback visible)
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [id]);

  useEffect(() => {
    if (!playing) return;
    if (cursor >= events.length) {
      setPlaying(false);
      return;
    }
    const next = events[cursor + 1];
    const cur = events[cursor];
    if (!next || !cur) {
      setPlaying(false);
      return;
    }
    const dt = Math.max(
      80,
      (new Date(next.at).getTime() - new Date(cur.at).getTime()) / speed,
    );
    timer.current = window.setTimeout(() => setCursor((c) => c + 1), Math.min(dt, 2000));
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [playing, cursor, events, speed]);

  const visible = useMemo(() => events.slice(0, cursor + 1), [events, cursor]);
  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader eyebrow="Replay" title="Loading…" />
      </div>
    );
  }
  if (!task) {
    return (
      <div className="p-8 text-[13px] text-fg-2">
        Task not found.{' '}
        <Link to="/board" className="text-accent hover:underline">
          Back to board
        </Link>
      </div>
    );
  }

  const startAt = events[0] ? new Date(events[0].at).getTime() : 0;
  const endAt = events[events.length - 1] ? new Date(events[events.length - 1]!.at).getTime() : startAt;
  const totalMs = Math.max(1, endAt - startAt);
  const currentEvent = events[Math.min(cursor, events.length - 1)];
  const currentMs = currentEvent ? new Date(currentEvent.at).getTime() - startAt : 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        eyebrow={`Task ${task.id.slice(0, 8)}`}
        title={`Replay · ${task.title}`}
        subtitle={
          <>
            <span className="text-fg tnum">{events.length}</span> events ·{' '}
            <span className="text-fg">{Math.round(totalMs / 60000)}</span> min total
          </>
        }
        actions={
          <>
            <button
              type="button"
              className={playing ? 'btn btn-sm' : 'btn-ghost btn-sm'}
              onClick={() => setPlaying((p) => !p)}
              disabled={cursor >= events.length}
            >
              {playing ? '⏸ Pause' : '▶ Play'}
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => {
                setCursor(0);
                setPlaying(false);
              }}
            >
              ⏮
            </button>
            <select
              className="input py-1 text-[12px]"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            >
              <option value={1}>1×</option>
              <option value={4}>4×</option>
              <option value={16}>16×</option>
              <option value={64}>64×</option>
              <option value={256}>256×</option>
            </select>
          </>
        }
      />

      {/* Scrubber */}
      <div className="border-b border-hairline px-6 py-2">
        <input
          type="range"
          min={0}
          max={Math.max(0, events.length - 1)}
          value={cursor}
          onChange={(e) => setCursor(Number(e.target.value))}
          className="w-full accent-accent"
        />
        <div className="mt-1 flex justify-between text-[10px] text-fg-3 font-mono">
          <span>{currentEvent ? formatMs(currentMs) : '00:00'}</span>
          <span>
            {Math.min(cursor + 1, events.length)} / {events.length}
          </span>
          <span>{formatMs(totalMs)}</span>
        </div>
      </div>

      {/* Event stream */}
      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        <ul className="space-y-2">
          {visible.map((e, i) => {
            const agent = e.agentId ? agentById.get(e.agentId) : null;
            const active = i === visible.length - 1;
            return (
              <li
                key={i}
                className={[
                  'flex items-start gap-3 rounded-xl px-3 py-2 transition',
                  active ? 'border border-accent/40 bg-violet-soft' : 'bg-sheen/[0.02]',
                ].join(' ')}
              >
                {agent ? (
                  <AgentAvatar agent={agent} size="sm" />
                ) : (
                  <span className="h-6 w-6 rounded-full bg-sheen/[0.06]" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[10px] text-fg-3 font-mono">
                    <span className="text-fg-2">{e.kind}</span>
                    {agent ? <span>· {agent.name}</span> : null}
                    <span className="ml-auto">{relativeTime(e.at)}</span>
                  </div>
                  <ReplayBody event={e} />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function ReplayBody({ event }: { event: ReplayEvent }) {
  const p = event.payload as Record<string, unknown>;
  if (event.kind === 'message') {
    return (
      <>
        <p className="mt-0.5 text-[11px] text-fg-3">
          {String(p.type ?? '')} → {(p.to as string)?.slice(0, 8) ?? '*'}
        </p>
        <p className="mt-0.5 text-[12.5px] text-fg">{String(p.subject ?? '(no subject)')}</p>
      </>
    );
  }
  if (event.kind === 'commit') {
    return (
      <p className="mt-0.5 text-[12.5px] text-fg">
        <span className="font-mono text-[#ffcc80]">⎇ {String(p.sha ?? '').slice(0, 7)}</span>{' '}
        {String(p.message ?? '')}
      </p>
    );
  }
  // activity
  const eventType = String(p.eventType ?? '');
  if (eventType === 'agent.thinking') {
    const text = String(p.text ?? '');
    const trimmed = text.length > 240 ? text.slice(0, 240) + '…' : text;
    return (
      <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-[11px] leading-relaxed text-violet-bright">
        {trimmed}
      </p>
    );
  }
  if (eventType === 'tool_call' || eventType === 'agent.tool_attempt') {
    const tool = String(p.tool ?? '?').replace('mcp__agentboard__', '');
    return <p className="mt-0.5 font-mono text-[11px] text-fg">{tool}</p>;
  }
  return (
    <p className="mt-0.5 text-[11px] text-fg-3">
      {eventType}
    </p>
  );
}

function formatMs(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
