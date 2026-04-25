import { Link } from 'react-router-dom';
import type { ActivityItem as ActivityItemType, Agent } from '@/lib/types';
import { AgentAvatar } from './AgentAvatar';
import { relativeTime } from '@/lib/time';

interface Props {
  item: ActivityItemType;
  agent?: Agent | null;
  toAgent?: Agent | null;
}

interface EventMeta {
  mark: string;
  label: string;
  tone: string;
  rail: string;
}

const EVENT_META: Record<string, EventMeta> = {
  'agent.thinking':     { mark: '◌',  label: 'Thought',  tone: 'text-violet-bright', rail: 'border-violet/40' },
  'agent.tool_attempt': { mark: '◦',  label: 'Invoke',   tone: 'text-warn',          rail: 'border-warn/40' },
  tool_call:            { mark: '●',  label: 'Tool',     tone: 'text-fg-2',          rail: 'border-hairline' },
  'agent.status':       { mark: '◐',  label: 'Status',   tone: 'text-warn',          rail: 'border-hairline' },
  'task.updated':       { mark: '▣',  label: 'Task',     tone: 'text-[#8fcfff]',     rail: 'border-[#8fcfff]/40' },
  'task.created':       { mark: '+',  label: 'New task', tone: 'text-ok',            rail: 'border-ok/40' },
  'message.sent':       { mark: '✎',  label: 'Message',  tone: 'text-violet',        rail: 'border-violet/40' },
  'commit.created':     { mark: '⎇',  label: 'Commit',   tone: 'text-[#ffcc80]',     rail: 'border-[#ffcc80]/40' },
  'approval.requested': { mark: '?',  label: 'Approval', tone: 'text-warn',          rail: 'border-warn/40' },
  'approval.resolved':  { mark: '✓',  label: 'Decision', tone: 'text-ok',            rail: 'border-ok/40' },
  session_stop:         { mark: '■',  label: 'Stop',     tone: 'text-fg-3',          rail: 'border-hairline' },
};

export function ActivityItem({ item, agent }: Props) {
  const meta = EVENT_META[item.eventType] ?? {
    mark: '·',
    label: item.eventType,
    tone: 'text-fg-3',
    rail: 'border-hairline',
  };
  const subjectName = agent?.name ?? 'system';

  return (
    <li className="group flex items-start gap-3 px-6 py-2.5 hover:bg-sheen/[0.02]">
      {/* Avatar (column 1) */}
      <div className="flex shrink-0 items-center pt-0.5">
        {agent ? (
          <Link to={`/agents/${agent.id}`}>
            <AgentAvatar agent={agent} size="sm" showStatus />
          </Link>
        ) : (
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-sheen/[0.06] text-[9px] text-fg-3">
            sys
          </span>
        )}
      </div>

      {/* Body (column 2) */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 leading-tight">
          <span className={['shrink-0 text-[13px] leading-none', meta.tone].join(' ')}>
            {meta.mark}
          </span>
          <span className="eyebrow shrink-0">{meta.label}</span>
          <span className="text-[12.5px] font-medium text-fg">{subjectName}</span>
        </div>

        <div className="mt-1">
          <EventBody item={item} meta={meta} />
        </div>
      </div>

      {/* Timestamp (column 3) */}
      <time
        className="shrink-0 self-start pt-0.5 font-mono text-[10px] text-fg-3 tnum"
        dateTime={item.createdAt}
        title={new Date(item.createdAt).toLocaleString()}
      >
        {relativeTime(item.createdAt)}
      </time>
    </li>
  );
}

/* ──────── Per-type body rendering ─────── */
function EventBody({ item, meta }: { item: ActivityItemType; meta: EventMeta }) {
  const p = (item.payload ?? {}) as Record<string, unknown>;

  if (item.eventType === 'agent.thinking') {
    const text = String(p.text ?? '').trim();
    if (!text) return <span className="text-[12px] text-fg-3 italic">(empty thought)</span>;
    const trimmed = text.length > 360 ? text.slice(0, 360) + '…' : text;
    return (
      <article className={['rounded-lg border bg-violet-soft/40 px-3 py-2', meta.rail].join(' ')}>
        <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-fg">{trimmed}</p>
      </article>
    );
  }

  if (item.eventType === 'agent.tool_attempt' || item.eventType === 'tool_call') {
    const tool = prettyTool(String(p.tool ?? '?'));
    const inputHint = summarizeInput(p.input);
    const attempting = item.eventType === 'agent.tool_attempt';
    return (
      <div className="flex items-center gap-2">
        <span
          className={[
            'pill font-mono text-[10px]',
            attempting ? 'pill-warn' : '',
          ].join(' ')}
        >
          {tool}
        </span>
        {inputHint ? (
          <span className="truncate font-mono text-[11px] text-fg-2">{inputHint}</span>
        ) : null}
      </div>
    );
  }

  if (item.eventType === 'message.sent') {
    const subject = String(p.subject ?? '');
    const messageType = String(p.messageType ?? '');
    const toAgentId = (p.toAgentId as string) ?? null;
    return (
      <div className="space-y-0.5">
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-fg-3">
          {messageType ? <span className="text-fg-2">{messageType}</span> : null}
          <span>→</span>
          <span className="font-mono text-fg">
            {toAgentId ? toAgentId.slice(0, 8) : 'all'}
          </span>
        </div>
        <p className="line-clamp-2 text-[12.5px] text-fg">{subject || '(no subject)'}</p>
      </div>
    );
  }

  if (item.eventType === 'commit.created') {
    const sha = String(p.sha ?? '').slice(0, 7);
    const message = String(p.message ?? '');
    return (
      <div className="flex items-center gap-2">
        <Link
          to={`/commits?focus=${sha}`}
          className="pill font-mono text-[10px] text-[#ffcc80]"
          onClick={(e) => e.stopPropagation()}
        >
          {sha}
        </Link>
        <span className="line-clamp-1 text-[12.5px] text-fg">{message}</span>
      </div>
    );
  }

  if (item.eventType === 'task.created') {
    const title = String(p.title ?? '');
    return (
      <p className="line-clamp-2 text-[12.5px] text-fg">
        <span className="text-fg-3">filed </span>
        <span className="text-fg">"{title}"</span>
      </p>
    );
  }

  if (item.eventType === 'task.updated') {
    const status = String(p.status ?? '');
    return (
      <p className="text-[12px] text-fg-2">
        moved to <span className="font-mono text-fg">{status}</span>
      </p>
    );
  }

  if (item.eventType === 'agent.status') {
    const status = String(p.status ?? '');
    const tone =
      status === 'working' ? 'text-warn' :
      status === 'error' || status === 'blocked' ? 'text-err' :
      'text-ok';
    return (
      <p className="text-[12px] text-fg-2">
        became <span className={['font-mono', tone].join(' ')}>{status}</span>
      </p>
    );
  }

  if (item.eventType === 'approval.requested') {
    const title = String(p.title ?? '');
    return (
      <p className="text-[12px] text-fg-2">
        <Link to="/approvals" className="text-warn hover:underline">
          asked for approval:
        </Link>{' '}
        <span className="text-fg">"{title}"</span>
      </p>
    );
  }
  if (item.eventType === 'approval.resolved') {
    const status = String(p.status ?? '');
    return (
      <p className="text-[12px] text-fg-2">
        approval{' '}
        <span className={status === 'approved' ? 'text-ok' : 'text-err'}>{status}</span>
      </p>
    );
  }

  if (item.eventType === 'session_stop') {
    return <p className="text-[12px] text-fg-3 italic">turn ended</p>;
  }

  // Fallback for unknown types
  const json = JSON.stringify(p);
  return (
    <p className="line-clamp-1 font-mono text-[11px] text-fg-3">
      {json.length > 120 ? json.slice(0, 120) + '…' : json}
    </p>
  );
}

/* ─────── helpers ─────── */
function prettyTool(tool: string): string {
  if (tool.startsWith('mcp__agentboard__')) return tool.slice('mcp__agentboard__'.length);
  return tool;
}
function summarizeInput(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  if (typeof o.command === 'string') return `$ ${o.command.slice(0, 80)}`;
  if (typeof o.file_path === 'string') {
    const p = o.file_path;
    return p.split('/').slice(-2).join('/');
  }
  if (typeof o.subject === 'string') return `"${o.subject.slice(0, 50)}"`;
  if (typeof o.title === 'string') return `"${o.title.slice(0, 50)}"`;
  if (typeof o.message === 'string') return `"${o.message.slice(0, 50)}"`;
  return null;
}
