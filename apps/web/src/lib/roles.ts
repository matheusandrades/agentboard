import type { AgentRole, AgentStatus } from './types';

/**
 * Per-role illustrated portrait. Two hand-drawn avatars are bundled under
 * `public/avatars/` — one femme (Lia) and one masc (Ethan). Roles are split
 * across them so every agent has a face instead of just initials.
 */
export const ROLE_PORTRAIT: Record<AgentRole, string> = {
  pm: '/avatars/lia.png',
  'ui-ux': '/avatars/lia.png',
  dba: '/avatars/lia.png',
  qa: '/avatars/lia.png',
  cto: '/avatars/ethan.png',
  'lang-specialist': '/avatars/ethan.png',
  frontend: '/avatars/ethan.png',
  backend: '/avatars/ethan.png',
  cybersec: '/avatars/ethan.png',
};

/**
 * Each role maps to a gradient pair used for the avatar — muted but distinct.
 * We keep raw CSS gradients so components get consistent glassy color blobs.
 */
export const ROLE_GRADIENTS: Record<AgentRole, string> = {
  pm: 'linear-gradient(135deg, #c69fff 0%, #7a5cff 100%)',
  cto: 'linear-gradient(135deg, #ff8098 0%, #c42d58 100%)',
  'ui-ux': 'linear-gradient(135deg, #ffb8e8 0%, #ff4fa1 100%)',
  'lang-specialist': 'linear-gradient(135deg, #7bdcff 0%, #3a7fd4 100%)',
  frontend: 'linear-gradient(135deg, #92b7ff 0%, #3861d4 100%)',
  backend: 'linear-gradient(135deg, #8cedb5 0%, #1faa66 100%)',
  dba: 'linear-gradient(135deg, #ffd38a 0%, #e39212 100%)',
  qa: 'linear-gradient(135deg, #e1a7ff 0%, #9436d4 100%)',
  cybersec: 'linear-gradient(135deg, #ff8c8c 0%, #b22222 100%)',
};

/** Hex accent for role text/ring — complement to the gradient. */
export const ROLE_TINT: Record<AgentRole, string> = {
  pm: 'text-[#b097ff]',
  cto: 'text-[#ff8098]',
  'ui-ux': 'text-[#ffadd7]',
  'lang-specialist': 'text-[#8fcfff]',
  frontend: 'text-[#9db5ff]',
  backend: 'text-[#79e0a3]',
  dba: 'text-[#ffcc80]',
  qa: 'text-[#d6a0ff]',
  cybersec: 'text-[#ff9b9b]',
};

export const ROLE_RING: Record<AgentRole, string> = {
  pm: 'ring-[#b097ff]/30',
  cto: 'ring-[#ff8098]/30',
  'ui-ux': 'ring-[#ffadd7]/30',
  'lang-specialist': 'ring-[#8fcfff]/30',
  frontend: 'ring-[#9db5ff]/30',
  backend: 'ring-[#79e0a3]/30',
  dba: 'ring-[#ffcc80]/30',
  qa: 'ring-[#d6a0ff]/30',
  cybersec: 'ring-[#ff9b9b]/30',
};

export const STATUS_DOT: Record<AgentStatus, { color: string; pulse: boolean; label: string }> = {
  idle: { color: 'bg-ok', pulse: false, label: 'Idle' },
  working: { color: 'bg-warn', pulse: true, label: 'Working' },
  blocked: { color: 'bg-err', pulse: false, label: 'Blocked' },
  error: { color: 'bg-err', pulse: false, label: 'Error' },
};

export function initials(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return '?';
  const parts = cleaned
    .replace(/[_.]/g, '-')
    .split(/[-\s]+/)
    .filter(Boolean);
  if (parts.length === 1) return (parts[0] ?? '?').slice(0, 2).toUpperCase();
  return `${(parts[0] ?? '?')[0] ?? ''}${(parts[1] ?? '?')[0] ?? ''}`.toUpperCase();
}

/** Deterministic hue from a string — used when role is unknown. */
export function hashHue(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return h % 360;
}
