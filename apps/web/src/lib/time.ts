/**
 * Format an ISO timestamp (or Date) as a short relative string
 * ("just now", "Xs ago", "Xm ago", "Xh ago", "yesterday", or local date).
 */
export function relativeTime(input: string | number | Date, now: Date = new Date()): string {
  const then = typeof input === 'string' || typeof input === 'number' ? new Date(input) : input;
  if (Number.isNaN(then.getTime())) return '';
  const diffMs = now.getTime() - then.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString();
}

export function formatTimestamp(input: string | number | Date): string {
  const d = typeof input === 'string' || typeof input === 'number' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}
