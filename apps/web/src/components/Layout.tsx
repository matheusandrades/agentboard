import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useBoardStore } from '@/lib/store';
import { getInitialTheme, toggleTheme, type ThemeMode } from '@/lib/theme';
import { ChatLauncher } from './ChatLauncher';
import { CommandPalette } from './CommandPalette';
import type { AgentStatus } from '@/lib/types';

// Sidebar is grouped by purpose — shorter visual runs, clear intent.
// Chat lives in a floating FAB (<ChatLauncher>), not the sidebar.
type NavItem = {
  to: string;
  label: string;
  icon: (p: { className?: string }) => JSX.Element;
  badgeFrom?: 'approvals';
};

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Now',
    items: [
      { to: '/dashboard', label: 'Home', icon: HomeIcon },
      { to: '/live', label: 'Live', icon: LiveIcon },
      { to: '/board', label: 'Board', icon: BoardIcon },
      { to: '/approvals', label: 'Approve', icon: ApproveIcon, badgeFrom: 'approvals' },
    ],
  },
  {
    label: 'Team',
    items: [
      { to: '/agents', label: 'Agents', icon: AgentsIcon },
    ],
  },
  {
    label: 'Code',
    items: [
      { to: '/projects', label: 'Repos', icon: RepoIcon },
      { to: '/previews', label: 'Preview', icon: PreviewIcon },
      { to: '/commits', label: 'Commits', icon: CommitIcon },
    ],
  },
  {
    label: 'Insights',
    items: [
      { to: '/usage', label: 'Usage', icon: SpendIcon },
      { to: '/timeline', label: 'Timeline', icon: TimelineIcon },
    ],
  },
];

// Settings sits at the bottom of the dock, isolated from day-to-day nav.
const FOOTER_NAV: NavItem = { to: '/settings', label: 'Setup', icon: SettingsIcon };

export function Layout() {
  const initSync = useBoardStore((s) => s.initSync);
  const agents = useBoardStore((s) => s.agents);
  const connectionError = useBoardStore((s) => s.connectionError);
  const wsStatus = useBoardStore((s) => s.wsStatus);

  useEffect(() => {
    const unsub = initSync();
    return unsub;
  }, [initSync]);

  const counts = useMemo(() => countByStatus(agents), [agents]);
  const pendingApprovals = useBoardStore((s) => s.approvals).filter((a) => a.status === 'pending').length;
  const [theme, setThemeState] = useState<ThemeMode>(() => getInitialTheme());
  function onToggleTheme() {
    setThemeState(toggleTheme());
  }

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-canvas text-fg">
      {/* Sidebar — hidden on mobile, visible md+ */}
      <aside className="relative hidden w-[76px] shrink-0 flex-col items-center border-r border-hairline bg-canvas-sunken/50 py-4 backdrop-blur-xl md:flex">
        <Brand />
        <nav className="mt-6 flex flex-1 flex-col items-center gap-0.5 self-stretch">
          {NAV_GROUPS.map((group, gi) => (
            <div key={group.label} className="flex flex-col items-center self-stretch">
              {gi > 0 ? (
                <div className="my-2 h-px w-8 self-center bg-hairline" aria-hidden />
              ) : null}
              {group.items.map((item) => (
                <NavItemButton
                  key={item.to}
                  item={item}
                  badge={item.badgeFrom === 'approvals' ? pendingApprovals : 0}
                />
              ))}
            </div>
          ))}
        </nav>

        {/* Footer: settings + version */}
        <div className="mt-auto flex w-full flex-col items-center gap-2 pt-3">
          <div className="h-px w-8 bg-hairline" aria-hidden />
          <NavItemButton item={FOOTER_NAV} badge={0} />
          <div className="dateline pb-1 pt-1 text-center text-[9px]">
            v0.1
            <br />
            PREVIEW
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Glass top bar */}
        <header className="relative flex h-14 shrink-0 items-center justify-between gap-3 border-b border-hairline bg-canvas/60 px-3 backdrop-blur-xl md:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn-icon md:hidden"
              onClick={() => setMobileNavOpen((o) => !o)}
              aria-label="Open navigation"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-4 w-4">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <h1 className="display text-[17px] font-semibold tracking-tight text-fg">AgentBoard</h1>
            <span className="hidden md:inline-flex pill">
              <span className="h-1.5 w-1.5 rounded-full bg-violet animate-breath" />
              live
            </span>
          </div>
          <div className="flex items-center gap-5 text-xs">
            <StatusSummary counts={counts} />
            <ConnectionPill status={wsStatus} />
            <button
              type="button"
              onClick={onToggleTheme}
              className="btn-icon"
              title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? (
                // Sun icon
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="h-4 w-4">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
                </svg>
              ) : (
                // Moon icon
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
                </svg>
              )}
            </button>
          </div>
        </header>

        {connectionError ? (
          <div className="flex items-center gap-3 border-b border-err/30 bg-err-soft px-6 py-2 text-xs text-err">
            <span className="font-mono uppercase tracking-wider">Offline</span>
            <span className="text-fg">{connectionError}</span>
          </div>
        ) : null}

        <main className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      {/* Mobile nav drawer */}
      {mobileNavOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={() => setMobileNavOpen(false)}
        >
          <aside
            className="flex h-full w-64 flex-col gap-2 border-r border-hairline bg-canvas-raised p-4 animate-sheet-in"
            onClick={(e) => e.stopPropagation()}
          >
            <Brand />
            <nav className="mt-4 flex flex-col gap-2">
              {NAV_GROUPS.map((g) => (
                <div key={g.label} className="flex flex-col gap-0.5">
                  <span className="eyebrow px-2 pt-2">{g.label}</span>
                  {g.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        onClick={() => setMobileNavOpen(false)}
                        className={({ isActive }) =>
                          [
                            'flex items-center gap-3 rounded-xl px-3 py-2 text-[13px]',
                            isActive ? 'bg-sheen/[0.06] text-fg' : 'text-fg-2',
                          ].join(' ')
                        }
                      >
                        <Icon className="h-4 w-4" />
                        {item.label}
                      </NavLink>
                    );
                  })}
                </div>
              ))}
            </nav>
          </aside>
        </div>
      ) : null}

      {/* Global floating chat — ⌘J */}
      <ChatLauncher />

      {/* Global command palette — ⌘K */}
      {paletteOpen ? <CommandPalette onClose={() => setPaletteOpen(false)} /> : null}
    </div>
  );
}

/* ─────────────────────── Dock NavLink item ───────────────────── */
function NavItemButton({ item, badge }: { item: NavItem; badge: number }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      title={item.label}
      className={({ isActive }) =>
        [
          'group relative flex w-14 flex-col items-center justify-center gap-1 rounded-xl py-2 text-fg-3 transition',
          isActive
            ? 'bg-sheen/[0.06] text-fg shadow-glass-sm'
            : 'hover:bg-sheen/[0.03] hover:text-fg',
        ].join(' ')
      }
    >
      <Icon className="h-5 w-5" />
      <span className="text-[9px] font-medium leading-none tracking-wide">{item.label}</span>
      {badge > 0 ? (
        <span className="absolute right-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-warn px-1 text-[9px] font-semibold text-canvas tnum animate-breath">
          {badge}
        </span>
      ) : null}
    </NavLink>
  );
}

function Brand() {
  return (
    <div className="flex flex-col items-center">
      <img
        src="/brand/logo.png"
        alt="AgentBoard"
        className="h-11 w-11 select-none"
        draggable={false}
      />
    </div>
  );
}

/* ───────────────────────── Status summary ─────────────────────── */
interface StatusCounts {
  total: number;
  idle: number;
  working: number;
  blocked: number;
  error: number;
}

function countByStatus(agents: { status: AgentStatus }[]): StatusCounts {
  const c: StatusCounts = { total: agents.length, idle: 0, working: 0, blocked: 0, error: 0 };
  for (const a of agents) c[a.status] += 1;
  return c;
}

function StatusSummary({ counts }: { counts: StatusCounts }) {
  return (
    <div className="flex items-center gap-4 font-mono tnum text-fg-2">
      <span className="inline-flex items-center gap-1.5">
        <Dot color="bg-ok" />
        <span className="tnum text-fg">{counts.idle}</span>
        <span className="text-fg-3">idle</span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Dot color="bg-warn" pulse={counts.working > 0} />
        <span className="tnum text-fg">{counts.working}</span>
        <span className="text-fg-3">busy</span>
      </span>
      {counts.blocked + counts.error > 0 ? (
        <span className="inline-flex items-center gap-1.5">
          <Dot color="bg-err" />
          <span className="tnum text-fg">{counts.blocked + counts.error}</span>
          <span className="text-fg-3">blocked</span>
        </span>
      ) : null}
    </div>
  );
}

function Dot({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <span
      className={[
        'inline-block h-1.5 w-1.5 rounded-full',
        color,
        pulse ? 'animate-breath' : '',
      ].join(' ')}
    />
  );
}

function ConnectionPill({ status }: { status: 'connecting' | 'open' | 'closed' }) {
  const label = status === 'open' ? 'Live' : status === 'connecting' ? 'Connecting' : 'Offline';
  const cls =
    status === 'open' ? 'pill pill-ok' : status === 'connecting' ? 'pill pill-warn' : 'pill pill-err';
  return (
    <span className={cls}>
      <span
        className={[
          'h-1.5 w-1.5 rounded-full',
          status === 'open' ? 'bg-ok animate-breath' : status === 'connecting' ? 'bg-warn' : 'bg-err',
        ].join(' ')}
      />
      {label}
    </span>
  );
}

/* ─────────────────────────── Icons ────────────────────────────── */
type IconProps = { className?: string };

function HomeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 11l8-7 8 7v9a2 2 0 01-2 2h-3v-7H9v7H6a2 2 0 01-2-2v-9z" />
    </svg>
  );
}
function SpendIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 19h18" />
      <path d="M5 19V11" />
      <path d="M11 19V7" />
      <path d="M17 19v-5" />
    </svg>
  );
}
function RepoIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 4.5h12a2 2 0 012 2v11a1.5 1.5 0 01-1.5 1.5H7a2 2 0 01-2-2V4.5z" />
      <path d="M5 17.5a2 2 0 012-2h11" />
      <path d="M9 8h6" />
    </svg>
  );
}
function SettingsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="2.8" />
      <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
    </svg>
  );
}
function ApproveIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 12l4 4 10-10" />
      <path d="M4 19h16" opacity="0.35" />
    </svg>
  );
}
function PreviewIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="4.5" width="18" height="13" rx="2" />
      <path d="M3 8h18" />
      <circle cx="6.5" cy="6.25" r="0.5" fill="currentColor" />
      <circle cx="8.5" cy="6.25" r="0.5" fill="currentColor" />
      <circle cx="10.5" cy="6.25" r="0.5" fill="currentColor" />
    </svg>
  );
}
function LiveIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M3 12c0-5 4-9 9-9s9 4 9 9" opacity="0.6" />
    </svg>
  );
}
function BoardIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className={className}>
      <rect x="3" y="3.5" width="5.5" height="17" rx="1.5" />
      <rect x="10.25" y="3.5" width="5.5" height="11" rx="1.5" />
      <rect x="17.5" y="3.5" width="3.5" height="7" rx="1.5" />
    </svg>
  );
}
function AgentsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="9" cy="8.5" r="3.2" />
      <circle cx="17" cy="10" r="2.4" />
      <path d="M2.5 19.5c0.5-3 3.5-4.8 6.5-4.8s5.5 1.5 6.3 4.3" />
      <path d="M15 18.5c0.6-2 2.5-3.3 4.2-3.3" />
    </svg>
  );
}
function TimelineIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className={className}>
      <circle cx="5" cy="6" r="1.4" />
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="5" cy="18" r="1.4" />
      <path d="M8.5 6h11.5M8.5 12h11.5M8.5 18h11.5" />
    </svg>
  );
}
function CommitIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M3 12h6M15 12h6" />
    </svg>
  );
}
function ChatIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 5.5h16v11.5H9.5L5.5 20V5.5z" />
    </svg>
  );
}
function SprintIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className={className}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </svg>
  );
}
