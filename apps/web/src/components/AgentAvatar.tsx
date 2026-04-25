import type { Agent, AgentStatus } from '@/lib/types';
import { ROLE_GRADIENTS, ROLE_PORTRAIT, ROLE_RING, STATUS_DOT, hashHue, initials } from '@/lib/roles';

interface Props {
  agent?: Pick<Agent, 'name' | 'role' | 'status'> | null;
  name?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showStatus?: boolean;
  status?: AgentStatus;
  title?: string;
}

const SIZE = {
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-base',
  xl: 'h-24 w-24 text-2xl',
} as const;

const DOT = {
  sm: 'h-2 w-2 -right-0 -bottom-0',
  md: 'h-2.5 w-2.5 -right-0 -bottom-0',
  lg: 'h-3 w-3 -right-0.5 -bottom-0.5',
  xl: 'h-4 w-4 -right-1 -bottom-1',
} as const;

export function AgentAvatar({ agent, name, size = 'md', showStatus, status, title }: Props) {
  const displayName = agent?.name ?? name ?? '';
  const role = agent?.role;
  const resolvedStatus = status ?? agent?.status;

  const portrait = role ? ROLE_PORTRAIT[role] : undefined;
  const gradient = role ? ROLE_GRADIENTS[role] : `hsl(${hashHue(displayName || 'unknown')} 70% 55%)`;
  const ring = role ? ROLE_RING[role] : 'ring-white/10';

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      title={title ?? displayName}
    >
      {portrait ? (
        <img
          src={portrait}
          alt={displayName}
          draggable={false}
          className={[
            'rounded-full object-cover object-center ring-1 ring-white/10 select-none',
            SIZE[size],
          ].join(' ')}
          style={{
            background: gradient,
            boxShadow:
              '0 6px 18px -8px rgba(0,0,0,0.6) inset, 0 0 0 1px rgba(255,255,255,0.08) inset',
          }}
        />
      ) : (
        <span
          className={[
            'inline-flex items-center justify-center rounded-full font-medium text-white/95 ring-1',
            SIZE[size],
            ring,
          ].join(' ')}
          style={{
            background: gradient,
            boxShadow:
              '0 6px 18px -8px rgba(0,0,0,0.6) inset, 0 0 0 1px rgba(255,255,255,0.08) inset',
          }}
        >
          {initials(displayName || '?')}
        </span>
      )}
      {showStatus && resolvedStatus ? <StatusDot status={resolvedStatus} size={size} /> : null}
    </span>
  );
}

function StatusDot({ status, size }: { status: AgentStatus; size: 'sm' | 'md' | 'lg' | 'xl' }) {
  const conf = STATUS_DOT[status];
  return (
    <span
      className={[
        'absolute rounded-full ring-2 ring-canvas',
        DOT[size],
        conf.color,
        conf.pulse ? 'animate-breath' : '',
      ].join(' ')}
      aria-label={conf.label}
    />
  );
}
