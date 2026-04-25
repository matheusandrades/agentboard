import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { AgentAvatar } from './AgentAvatar';
import { STATUS_DOT } from '@/lib/roles';
import type { Agent, AgentMessage as Message } from '@/lib/types';
import { AGENT_ROLES } from '@agentboard/shared';

const VIEWBOX = 720;
const CENTER = VIEWBOX / 2;
const NODE_RADIUS = 36;
const NODE_PAD = 12;
const ORBIT_RADIUS = 250;
const STAKEHOLDER_ID = '__stakeholder__';
const FLIGHT_MS = 1400;

interface Flight {
  id: string;
  fromKey: string;
  toKey: string;
  at: number; // ms epoch
  messageType: string;
}

interface Props {
  agents: Agent[];
  messages: Message[];
}

/**
 * Animated force/orbit graph of the team. Agents live on a circular orbit
 * around a small "stakeholder" hub. Every new inter-agent message spawns a
 * glowing pulse that travels from sender → recipient (broadcast spawns one
 * per teammate). The graph listens to the store and animates in real time.
 */
export function AgentGraph({ agents, messages }: Props) {
  const nameToKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents) m.set(a.name, a.id);
    m.set('stakeholder', STAKEHOLDER_ID);
    return m;
  }, [agents]);

  // Place each agent on the orbit, stakeholder at the center.
  const positions = useMemo(() => {
    const p = new Map<string, { x: number; y: number }>();
    const n = Math.max(agents.length, 1);
    agents.forEach((a, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      p.set(a.id, {
        x: CENTER + ORBIT_RADIUS * Math.cos(angle),
        y: CENTER + ORBIT_RADIUS * Math.sin(angle),
      });
    });
    p.set(STAKEHOLDER_ID, { x: CENTER, y: CENTER });
    return p;
  }, [agents]);

  // Track which messages we've already animated.
  const seenRef = useRef<Set<string>>(new Set());
  const [flights, setFlights] = useState<Flight[]>([]);

  // When the message list changes, pick up any unseen ones and spawn flights.
  useEffect(() => {
    const now = Date.now();
    const fresh: Flight[] = [];
    // Walk recent messages first (store is newest-first)
    for (const msg of messages.slice(0, 40)) {
      if (seenRef.current.has(msg.id)) continue;
      seenRef.current.add(msg.id);

      // Skip stale messages (> 4s old) so we don't flood on first mount.
      const msgTs = new Date(msg.createdAt).getTime();
      if (Number.isFinite(msgTs) && now - msgTs > 4_000) continue;

      const fromKey = nameToKey.get(msg.from);
      if (!fromKey) continue;

      if (msg.to === '*') {
        for (const target of agents) {
          if (target.name === msg.from) continue;
          fresh.push({
            id: `${msg.id}:${target.id}`,
            fromKey,
            toKey: target.id,
            at: now,
            messageType: msg.type,
          });
        }
      } else {
        const toKey = nameToKey.get(msg.to);
        if (!toKey) continue;
        fresh.push({ id: msg.id, fromKey, toKey, at: now, messageType: msg.type });
      }
    }
    if (fresh.length === 0) return;
    setFlights((prev) => [...prev, ...fresh]);

    // GC after each flight's lifetime.
    const ids = fresh.map((f) => f.id);
    const t = setTimeout(() => {
      setFlights((prev) => prev.filter((f) => !ids.includes(f.id)));
    }, FLIGHT_MS + 200);
    return () => clearTimeout(t);
  }, [messages, agents, nameToKey]);

  // Active edges = currently animating flights, grouped so we don't redraw
  // the same edge twice for a broadcast.
  const activeEdges = useMemo(() => {
    const s = new Set<string>();
    for (const f of flights) s.add(`${f.fromKey}→${f.toKey}`);
    return s;
  }, [flights]);

  return (
    <div className="relative mx-auto flex h-full w-full max-w-[720px] items-center justify-center">
      <svg
        viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
        className="h-full w-full max-h-[min(72vh,720px)]"
        aria-label="Agent interaction graph"
      >
        {/* Background: orbit ring */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={ORBIT_RADIUS}
          fill="none"
          stroke="rgb(var(--hairline) / 0.1)"
          strokeDasharray="4 6"
        />

        {/* Spokes from center to each agent — subtle guide lines */}
        {agents.map((a) => {
          const p = positions.get(a.id);
          if (!p) return null;
          const key = `${STAKEHOLDER_ID}→${a.id}`;
          const active = activeEdges.has(key) || activeEdges.has(`${a.id}→${STAKEHOLDER_ID}`);
          return (
            <line
              key={a.id + '-spoke'}
              x1={CENTER}
              y1={CENTER}
              x2={p.x}
              y2={p.y}
              stroke={active ? 'rgb(var(--accent) / 0.5)' : 'rgb(var(--hairline) / 0.06)'}
              strokeWidth={active ? 1.4 : 1}
            />
          );
        })}

        {/* Chords between agents — only drawn when active to reduce noise */}
        {agents.map((a, i) =>
          agents.slice(i + 1).map((b) => {
            const edgeAB = activeEdges.has(`${a.id}→${b.id}`);
            const edgeBA = activeEdges.has(`${b.id}→${a.id}`);
            if (!edgeAB && !edgeBA) return null;
            const pa = positions.get(a.id);
            const pb = positions.get(b.id);
            if (!pa || !pb) return null;
            return (
              <line
                key={`${a.id}-${b.id}`}
                x1={pa.x}
                y1={pa.y}
                x2={pb.x}
                y2={pb.y}
                className="edge-active"
                stroke="rgb(var(--accent) / 0.5)"
                strokeWidth={1.5}
              />
            );
          }),
        )}

        {/* Stakeholder hub */}
        <g transform={`translate(${CENTER},${CENTER})`}>
          <circle
            r={NODE_RADIUS - 6}
            fill="rgb(var(--canvas-raised))"
            stroke="rgb(var(--hairline) / 0.3)"
            strokeWidth={1.5}
          />
          <text
            y={4}
            textAnchor="middle"
            className="fill-fg-2 font-mono"
            style={{ fontSize: '10px', letterSpacing: '0.18em', textTransform: 'uppercase' }}
          >
            you
          </text>
        </g>

        {/* Agent nodes */}
        {agents.map((a) => {
          const p = positions.get(a.id);
          if (!p) return null;
          const status = STATUS_DOT[a.status];
          const title = AGENT_ROLES[a.role]?.title ?? a.role;
          const working = a.status === 'working';
          return (
            <g key={a.id} transform={`translate(${p.x},${p.y})`}>
              {working ? (
                <circle
                  r={NODE_RADIUS + 8}
                  fill="none"
                  stroke="rgb(var(--accent) / 0.5)"
                  strokeWidth={1.5}
                  className="animate-breath"
                />
              ) : null}
              <circle
                r={NODE_RADIUS}
                fill="rgb(var(--canvas-raised))"
                stroke="rgb(var(--hairline) / 0.2)"
                strokeWidth={1.5}
              />
              <foreignObject
                x={-(NODE_RADIUS - NODE_PAD)}
                y={-(NODE_RADIUS - NODE_PAD)}
                width={(NODE_RADIUS - NODE_PAD) * 2}
                height={(NODE_RADIUS - NODE_PAD) * 2}
              >
                <Link
                  to={`/agents/${a.id}`}
                  className="block h-full w-full"
                  title={`${a.name} · ${title} · ${status.label}`}
                >
                  <AgentAvatar agent={a} size="md" />
                </Link>
              </foreignObject>
              <circle
                r={5}
                cx={NODE_RADIUS - 6}
                cy={-(NODE_RADIUS - 6)}
                className={status.pulse ? 'animate-breath' : ''}
                style={{ fill: colorForDot(status.color) }}
                stroke="rgb(var(--canvas))"
                strokeWidth={1.5}
              />
              <text
                y={NODE_RADIUS + 16}
                textAnchor="middle"
                className="fill-fg font-mono"
                style={{ fontSize: '11px' }}
              >
                {a.name}
              </text>
              <text
                y={NODE_RADIUS + 30}
                textAnchor="middle"
                className="fill-fg-3 font-mono"
                style={{ fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase' }}
              >
                {title}
              </text>
            </g>
          );
        })}

        {/* Flights — the animated pulses that carry messages */}
        {flights.map((f) => {
          const fp = positions.get(f.fromKey);
          const tp = positions.get(f.toKey);
          if (!fp || !tp) return null;
          const color = tintForType(f.messageType);
          const style: CSSProperties & Record<string, string> = {
            ['--fx' as string]: `${fp.x}px`,
            ['--fy' as string]: `${fp.y}px`,
            ['--tx' as string]: `${tp.x}px`,
            ['--ty' as string]: `${tp.y}px`,
          };
          return (
            <g key={f.id} className="pulse-fly" style={style}>
              <circle r={7} fill={color} opacity={0.9} />
              <circle r={13} fill={color} opacity={0.2} />
            </g>
          );
        })}
      </svg>

      {/* Legend overlay */}
      <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1 text-[10px] text-fg-3">
        <LegendDot color="rgb(var(--accent))" label="assignment / dispatch" />
        <LegendDot color="rgb(var(--ok))" label="answer" />
        <LegendDot color="rgb(var(--warn))" label="question / handoff" />
        <LegendDot color="rgb(var(--err))" label="review" />
      </div>

      <div className="pointer-events-none absolute right-3 top-3 font-mono text-[10px] text-fg-3">
        {flights.length} in flight
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label}
    </div>
  );
}

function tintForType(type: string): string {
  switch (type) {
    case 'answer':
      return 'rgb(var(--ok))';
    case 'question':
    case 'handoff':
      return 'rgb(var(--warn))';
    case 'review':
      return 'rgb(var(--err))';
    default:
      return 'rgb(var(--accent))';
  }
}

/**
 * Our status dot color tokens are Tailwind class names (`bg-ok`, `bg-warn`…).
 * For the inline SVG we need the raw color — map back via CSS var lookup.
 */
function colorForDot(klass: string): string {
  if (klass.includes('warn')) return 'rgb(var(--warn))';
  if (klass.includes('err')) return 'rgb(var(--err))';
  if (klass.includes('ok')) return 'rgb(var(--ok))';
  if (klass.includes('accent')) return 'rgb(var(--accent))';
  return 'rgb(var(--fg-3))';
}
