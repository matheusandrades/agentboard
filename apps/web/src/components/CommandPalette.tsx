import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBoardStore } from '@/lib/store';

type Command = {
  id: string;
  label: string;
  hint?: string;
  group: string;
  /** Keyword search target. */
  match: string;
  run: () => void;
};

interface Props {
  onClose: () => void;
}

/**
 * Global ⌘K palette: search agents, tasks, projects, jump to pages, take
 * actions (open chat, new sprint, sync, etc). Replaces the "⌘K just opens
 * chat" behavior — chat is still here as the first action when the query
 * is empty, but the user can now do anything in 2 keystrokes.
 */
export function CommandPalette({ onClose }: Props) {
  const navigate = useNavigate();
  const agents = useBoardStore((s) => s.agents);
  const tasks = useBoardStore((s) => s.tasks);
  const sprints = useBoardStore((s) => s.sprints);

  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const allCommands = useMemo<Command[]>(() => {
    const list: Command[] = [
      { id: 'go-home', group: 'Go to', label: 'Home', hint: '/dashboard', match: 'home dashboard', run: () => navigate('/dashboard') },
      { id: 'go-live', group: 'Go to', label: 'Live', hint: '/live', match: 'live mission swimlanes graph', run: () => navigate('/live') },
      { id: 'go-board', group: 'Go to', label: 'Board', hint: '/board', match: 'kanban tasks', run: () => navigate('/board') },
      { id: 'go-agents', group: 'Go to', label: 'Agents', hint: '/agents', match: 'agents staff team', run: () => navigate('/agents') },
      { id: 'go-projects', group: 'Go to', label: 'Repos', hint: '/projects', match: 'repos github projects', run: () => navigate('/projects') },
      { id: 'go-previews', group: 'Go to', label: 'Previews', hint: '/previews', match: 'preview docker', run: () => navigate('/previews') },
      { id: 'go-approvals', group: 'Go to', label: 'Approvals', hint: '/approvals', match: 'approvals pending decisions', run: () => navigate('/approvals') },
      { id: 'go-commits', group: 'Go to', label: 'Commits', hint: '/commits', match: 'commits diff git', run: () => navigate('/commits') },
      { id: 'go-timeline', group: 'Go to', label: 'Timeline', hint: '/timeline', match: 'wire feed events timeline', run: () => navigate('/timeline') },
      { id: 'go-spend', group: 'Go to', label: 'Spend', hint: '/spend', match: 'cost spend money usage tokens', run: () => navigate('/spend') },
      { id: 'go-settings', group: 'Go to', label: 'Settings', hint: '/settings', match: 'settings setup integrations github', run: () => navigate('/settings') },
    ];

    for (const a of agents) {
      list.push({
        id: `agent-${a.id}`,
        group: 'Agents',
        label: a.name,
        hint: `${a.role} · ${a.status}`,
        match: `${a.name} ${a.role}`,
        run: () => navigate(`/agents/${a.id}`),
      });
    }

    for (const t of tasks.slice(0, 100)) {
      list.push({
        id: `task-${t.id}`,
        group: 'Tasks',
        label: t.title,
        hint: `${t.status} · ${t.id.slice(0, 8)}`,
        match: `${t.title} ${t.id}`,
        run: () => navigate(`/board?task=${t.id}`),
      });
    }

    for (const s of sprints) {
      list.push({
        id: `sprint-${s.id}`,
        group: 'Sprints',
        label: s.name,
        hint: s.status,
        match: `${s.name} sprint`,
        run: () => navigate(`/board?sprint=${s.id}`),
      });
    }

    return list;
  }, [agents, tasks, sprints, navigate]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allCommands.slice(0, 30);
    return allCommands
      .filter((c) => c.match.toLowerCase().includes(q) || c.label.toLowerCase().includes(q))
      .slice(0, 30);
  }, [allCommands, query]);

  // Keyboard nav
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = results[cursor];
        if (cmd) {
          cmd.run();
          onClose();
        }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [results, cursor, onClose]);

  // Reset cursor when filter changes
  useEffect(() => {
    setCursor(0);
  }, [query]);

  // Group results
  const grouped = useMemo(() => {
    const m = new Map<string, Command[]>();
    for (const c of results) {
      const arr = m.get(c.group);
      if (arr) arr.push(c);
      else m.set(c.group, [c]);
    }
    return m;
  }, [results]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-24 backdrop-blur-sm animate-float-in"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-hairline bg-canvas-raised shadow-glass-lg"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center gap-2 border-b border-hairline px-4 py-3">
          <span className="font-mono text-[11px] text-fg-3">⌘K</span>
          <input
            ref={inputRef}
            className="flex-1 border-0 bg-transparent p-0 text-[14px] text-fg placeholder:text-fg-3 focus:outline-none focus:ring-0"
            placeholder="Search agents, tasks, pages, actions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="font-mono text-[10px] text-fg-3">esc</span>
        </div>

        <div className="max-h-[50vh] overflow-auto">
          {results.length === 0 ? (
            <p className="px-4 py-6 text-center text-[12px] text-fg-3">No matches.</p>
          ) : (
            [...grouped.entries()].map(([group, items]) => (
              <div key={group}>
                <div className="sticky top-0 bg-canvas-raised/95 px-4 py-1 backdrop-blur">
                  <span className="eyebrow">{group}</span>
                </div>
                <ul>
                  {items.map((c) => {
                    const idx = results.indexOf(c);
                    const active = idx === cursor;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onMouseEnter={() => setCursor(idx)}
                          onClick={() => {
                            c.run();
                            onClose();
                          }}
                          className={[
                            'flex w-full items-center justify-between gap-3 px-4 py-2 text-left transition',
                            active ? 'bg-violet-soft' : 'hover:bg-sheen/[0.03]',
                          ].join(' ')}
                        >
                          <span className="truncate text-[13px] text-fg">{c.label}</span>
                          {c.hint ? (
                            <span className="truncate font-mono text-[10px] text-fg-3">{c.hint}</span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-hairline px-4 py-2 text-[10px] text-fg-3">
          <span>↑↓ navigate · enter select</span>
          <span>{results.length} results</span>
        </div>
      </div>
    </div>
  );
}
