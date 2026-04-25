import type { ReactNode } from 'react';

interface Props {
  eyebrow: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

/**
 * Compact page header — single row, thin border, no vertical bloat.
 * Designed so every page fits above the fold. Use for Board, Agents,
 * Timeline, Commits, Chat, Sprints.
 */
export function PageHeader({ eyebrow, title, subtitle, actions }: Props) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-4 border-b border-hairline px-6 py-3">
      <div className="min-w-0">
        <div className="flex items-baseline gap-3">
          <span className="eyebrow">{eyebrow}</span>
          <h2 className="truncate text-[18px] font-semibold tracking-tight text-fg">{title}</h2>
        </div>
        {subtitle ? <p className="mt-0.5 text-[11px] text-fg-2">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
