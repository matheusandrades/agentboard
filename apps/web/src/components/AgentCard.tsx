import { Link } from 'react-router-dom';
import type { Agent, Task, Message } from '@/lib/types';
import { AgentAvatar } from './AgentAvatar';
import { AGENT_ROLES } from '@agentboard/shared';
import { ROLE_TINT, STATUS_DOT } from '@/lib/roles';

interface Props {
  agent: Agent;
  tasks?: Task[];
  messages?: Message[];
}

export function AgentCard({ agent, tasks = [], messages = [] }: Props) {
  const current = tasks.find(
    (t) => t.assigneeId === agent.id && (t.status === 'in_progress' || t.status === 'review'),
  );
  const unread = messages.filter((m) => m.to === agent.name && !isFromSelf(m, agent)).length;
  const title = AGENT_ROLES[agent.role]?.title ?? agent.role;
  const status = STATUS_DOT[agent.status];
  const tint = ROLE_TINT[agent.role];

  return (
    <Link to={`/agents/${agent.id}`} className="glass hover-raise block p-5 transition">
      <div className="flex items-start gap-4">
        <AgentAvatar agent={agent} size="lg" showStatus />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="truncate text-[17px] font-medium tracking-tight text-fg">{agent.name}</h3>
            {unread > 0 ? (
              <span className="pill pill-violet tnum">{unread}</span>
            ) : null}
          </div>
          <p className={['mt-0.5 text-xs font-medium tracking-tight', tint ?? 'text-fg-2'].join(' ')}>
            {title}
          </p>
          <p className="mt-3 line-clamp-2 text-[12.5px] leading-relaxed text-fg-2">
            {current ? (
              <>
                <span className="text-fg-3">On: </span>
                <span className="text-fg">{current.title}</span>
              </>
            ) : (
              <span className="italic text-fg-3">No active task</span>
            )}
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-hairline pt-3">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-fg-2">
          <span
            className={[
              'h-1.5 w-1.5 rounded-full',
              status.color,
              status.pulse ? 'animate-breath' : '',
            ].join(' ')}
          />
          {status.label}
        </span>
        <span className="text-[10px] font-mono text-fg-3">
          {agent.sessionId ? 'session ready' : 'first boot'}
        </span>
      </div>
    </Link>
  );
}

function isFromSelf(message: Message, agent: Agent) {
  return message.from === agent.name;
}
