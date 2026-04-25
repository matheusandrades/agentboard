/**
 * VSCode-style file browser for a connected project.
 *
 *  ┌──────────────┬──────────────────────────────────────────────┐
 *  │ tree (lazy)  │ tab1 × | tab2 × | tab3 ×           ⌘P search │
 *  │              ├──────────────────────────────────────────────│
 *  │  ▸ apps      │ breadcrumb · port:55005 · open in github     │
 *  │  ▸ packages  ├──────────────────────────────────────────────│
 *  │    README.md │ syntax-highlighted file (line numbers)       │
 *  └──────────────┴──────────────────────────────────────────────┘
 *
 * Tree lazy-loads each folder. Multiple files can be open at once via
 * tabs. Cmd/Ctrl+P opens a fuzzy file picker that searches the whole
 * project. Files larger than 1 MB / detected binaries get a friendly
 * placeholder.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import * as api from '@/lib/api';
import type { Project } from '@/lib/types';
import { highlight } from './syntax';

interface Props {
  project: Project;
}

interface TreeNode extends api.TreeEntry {
  children?: TreeNode[];
  expanded?: boolean;
  loading?: boolean;
  loaded?: boolean;
}

interface OpenTab {
  path: string;
  file: api.FileResponse | null;
  loading: boolean;
  error: string | null;
}

const MAX_TABS = 10;

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function FileBrowser({ project }: Props) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [rootLoading, setRootLoading] = useState(true);
  const [rootError, setRootError] = useState<string | null>(null);
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);

  /* -------------------- root tree -------------------- */
  useEffect(() => {
    let cancelled = false;
    setRootLoading(true);
    setRootError(null);
    setTree([]);
    setTabs([]);
    setActivePath(null);
    api
      .projectTree(project.id, '')
      .then((res) => {
        if (cancelled) return;
        setTree(res.entries.map((e) => ({ ...e })));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setRootError(humanize(err));
      })
      .finally(() => {
        if (!cancelled) setRootLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  /* -------- expand a folder (lazy load children) -------- */
  const toggleDir = useCallback(
    async (target: TreeNode) => {
      const patch = (
        nodes: TreeNode[],
        edit: (n: TreeNode) => TreeNode | void,
      ): TreeNode[] =>
        nodes.map((n) => {
          if (n.path === target.path) {
            const updated = edit({ ...n }) ?? n;
            return updated;
          }
          if (n.children) return { ...n, children: patch(n.children, edit) };
          return n;
        });

      if (target.expanded) {
        setTree((cur) =>
          patch(cur, (n) => {
            n.expanded = false;
            return n;
          }),
        );
        return;
      }

      if (target.loaded) {
        setTree((cur) =>
          patch(cur, (n) => {
            n.expanded = true;
            return n;
          }),
        );
        return;
      }

      setTree((cur) =>
        patch(cur, (n) => {
          n.loading = true;
          n.expanded = true;
          return n;
        }),
      );
      try {
        const res = await api.projectTree(project.id, target.path);
        setTree((cur) =>
          patch(cur, (n) => {
            n.loading = false;
            n.loaded = true;
            n.children = res.entries.map((e) => ({ ...e }));
            return n;
          }),
        );
      } catch (err) {
        setTree((cur) =>
          patch(cur, (n) => {
            n.loading = false;
            n.loaded = false;
            n.expanded = false;
            return n;
          }),
        );
        // eslint-disable-next-line no-console
        console.warn(humanize(err));
      }
    },
    [project.id],
  );

  /* -------------------- open / close / switch tabs -------------------- */
  const openFile = useCallback(
    (path: string) => {
      setTabs((cur) => {
        const existing = cur.find((t) => t.path === path);
        if (existing) return cur;
        const next = [...cur, { path, file: null, loading: true, error: null }];
        // Cap. Drop the oldest non-active tab when the cap is hit.
        if (next.length > MAX_TABS) {
          const idx = next.findIndex((t) => t.path !== activePath);
          if (idx > -1) next.splice(idx, 1);
        }
        return next;
      });
      setActivePath(path);
    },
    [activePath],
  );

  // Lazy-load file content the first time a tab is opened (or refreshed).
  useEffect(() => {
    const t = tabs.find((x) => x.path === activePath);
    if (!t || (t.file && !t.loading)) return;
    let cancelled = false;
    api
      .projectFile(project.id, t.path)
      .then((res) => {
        if (cancelled) return;
        setTabs((cur) =>
          cur.map((x) => (x.path === t.path ? { ...x, file: res, loading: false } : x)),
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setTabs((cur) =>
          cur.map((x) =>
            x.path === t.path ? { ...x, file: null, loading: false, error: humanize(err) } : x,
          ),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [activePath, tabs, project.id]);

  function closeTab(path: string) {
    setTabs((cur) => {
      const idx = cur.findIndex((t) => t.path === path);
      if (idx === -1) return cur;
      const next = cur.slice(0, idx).concat(cur.slice(idx + 1));
      if (activePath === path) {
        const fallback = next[idx] ?? next[idx - 1] ?? null;
        setActivePath(fallback?.path ?? null);
      }
      return next;
    });
  }

  /* -------------------- Cmd/Ctrl+P quick picker -------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault();
        setPicker((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const activeTab = tabs.find((t) => t.path === activePath) ?? null;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr] overflow-hidden">
      {/* Tree */}
      <aside className="flex min-h-0 flex-col border-r border-hairline bg-canvas-sunken/40">
        <div className="flex shrink-0 items-center justify-between border-b border-hairline px-3 py-1.5">
          <span className="eyebrow">Explorer</span>
          <button
            type="button"
            onClick={() => setPicker(true)}
            className="inline-flex items-center gap-1 rounded border border-hairline bg-sheen/[0.04] px-1.5 py-0.5 text-[10px] text-fg-3 transition hover:text-fg"
            title="Quick open (⌘/Ctrl + P)"
          >
            <span className="font-mono">⌘P</span>
            <span>search</span>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto py-1.5 font-mono text-[12px]">
          {rootLoading ? (
            <p className="px-3 py-2 text-fg-3">Loading…</p>
          ) : rootError ? (
            <p className="px-3 py-2 text-err">{rootError}</p>
          ) : (
            <NodeList
              nodes={tree}
              depth={0}
              activePath={activePath}
              onSelect={openFile}
              onToggle={toggleDir}
            />
          )}
        </div>
      </aside>

      {/* Reader */}
      <section className="flex min-h-0 flex-col">
        {tabs.length > 0 ? (
          <Tabs
            tabs={tabs}
            activePath={activePath}
            onActivate={setActivePath}
            onClose={closeTab}
          />
        ) : null}

        {activeTab ? (
          <FileReader project={project} tab={activeTab} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center text-fg-3">
            <span className="text-[14px] text-fg-2">Pick a file from the tree</span>
            <p className="max-w-xs text-[11px]">
              Or hit{' '}
              <code className="rounded bg-sheen/[0.06] px-1 font-mono">⌘P</code> to fuzzy-search the
              whole repo. Files come from{' '}
              <code className="rounded bg-sheen/[0.06] px-1 font-mono">
                {project.clonePath ?? '—'}
              </code>
              .
            </p>
          </div>
        )}
      </section>

      {picker ? (
        <QuickOpen
          project={project}
          onClose={() => setPicker(false)}
          onOpen={(p) => {
            openFile(p);
            setPicker(false);
          }}
        />
      ) : null}
    </div>
  );
}

/* ============================ tabs ============================ */
function Tabs({
  tabs,
  activePath,
  onActivate,
  onClose,
}: {
  tabs: OpenTab[];
  activePath: string | null;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
}) {
  return (
    <div className="flex shrink-0 items-stretch gap-px overflow-x-auto border-b border-hairline bg-canvas-sunken/30 [scrollbar-width:thin]">
      {tabs.map((t) => {
        const active = t.path === activePath;
        const Icon = pickFileIcon(basename(t.path));
        return (
          <div
            key={t.path}
            className={[
              'group relative flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-[12px] transition',
              active
                ? 'bg-canvas-sunken/60 text-fg'
                : 'text-fg-2 hover:bg-canvas-sunken/40 hover:text-fg',
            ].join(' ')}
          >
            <button
              type="button"
              onClick={() => onActivate(t.path)}
              className="inline-flex max-w-[180px] items-center gap-1.5"
              title={t.path}
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-fg-3" />
              <span className="truncate font-mono">{basename(t.path)}</span>
              {t.loading ? <Spinner /> : null}
            </button>
            <button
              type="button"
              onClick={() => onClose(t.path)}
              className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-fg-3 opacity-0 transition hover:bg-sheen/[0.06] hover:text-fg group-hover:opacity-100"
              title="Close"
              aria-label={`Close ${basename(t.path)}`}
            >
              ×
            </button>
            {active ? (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" aria-hidden />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* ============================ tree row ============================ */
function NodeList({
  nodes,
  depth,
  activePath,
  onSelect,
  onToggle,
}: {
  nodes: TreeNode[];
  depth: number;
  activePath: string | null;
  onSelect: (path: string) => void;
  onToggle: (n: TreeNode) => void;
}) {
  return (
    <ul>
      {nodes.map((n) => (
        <li key={n.path}>
          <Row
            node={n}
            depth={depth}
            selected={activePath === n.path}
            onSelect={() => onSelect(n.path)}
            onToggle={() => onToggle(n)}
          />
          {n.expanded && n.children ? (
            <NodeList
              nodes={n.children}
              depth={depth + 1}
              activePath={activePath}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Row({
  node,
  depth,
  selected,
  onSelect,
  onToggle,
}: {
  node: TreeNode;
  depth: number;
  selected: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  const isDir = node.type === 'dir';
  const Icon = isDir ? (node.expanded ? FolderOpenIcon : FolderIcon) : pickFileIcon(node.name);
  const padding = 6 + depth * 12;
  const dim = node.ignored;
  return (
    <button
      type="button"
      onClick={isDir ? onToggle : onSelect}
      className={[
        'group flex w-full items-center gap-1.5 px-2 py-0.5 text-left text-fg-2 transition',
        selected ? 'bg-accent-soft text-fg' : 'hover:bg-sheen/[0.04] hover:text-fg',
        dim ? 'opacity-50' : '',
      ].join(' ')}
      style={{ paddingLeft: padding }}
      title={node.path}
    >
      {isDir ? (
        <span
          className={[
            'inline-flex h-3 w-3 shrink-0 items-center justify-center text-fg-3 transition',
            node.expanded ? 'rotate-90' : '',
          ].join(' ')}
        >
          {node.loading ? <Spinner /> : <Caret />}
        </span>
      ) : (
        <span className="inline-block h-3 w-3 shrink-0" />
      )}
      <Icon className="h-3.5 w-3.5 shrink-0 text-fg-3" />
      <span className="truncate">{node.name}</span>
      {!isDir && typeof node.size === 'number' ? (
        <span className="ml-auto pl-2 text-[10px] text-fg-3">{fmtBytes(node.size)}</span>
      ) : null}
    </button>
  );
}

/* ============================ file viewer ============================ */
function FileReader({ project, tab }: { project: Project; tab: OpenTab }) {
  const segments = tab.path.split('/');
  const ghUrl = useMemo(() => {
    const branch = project.defaultBranch || 'main';
    return `https://github.com/${project.repoOwner}/${project.repoName}/blob/${encodeURIComponent(
      branch,
    )}/${tab.path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;
  }, [project, tab.path]);

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-hairline px-4 py-2">
        <Breadcrumb segments={segments} />
        <span className="ml-auto inline-flex items-center gap-2 font-mono text-[11px] text-fg-3">
          {tab.file && tab.file.encoding === 'utf8' ? (
            <>
              <span>{tab.file.language}</span>
              <span>·</span>
              <span>{fmtBytes(tab.file.size)}</span>
              <span>·</span>
            </>
          ) : null}
          <a
            href={ghUrl}
            target="_blank"
            rel="noreferrer"
            className="hover:text-fg"
            title="Open on GitHub"
          >
            github ↗
          </a>
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-auto bg-canvas-sunken/30 font-mono text-[12.5px]">
        {tab.error ? (
          <p className="px-4 py-3 text-err">{tab.error}</p>
        ) : tab.loading || !tab.file ? (
          <p className="px-4 py-3 text-fg-3">Loading…</p>
        ) : tab.file.encoding === 'binary' ? (
          <Notice
            label="Binary file"
            detail={`This file looks like binary data (${fmtBytes(tab.file.size)}). Open it on GitHub to view.`}
            href={ghUrl}
          />
        ) : tab.file.encoding === 'too-large' ? (
          <Notice
            label="File is too big to show"
            detail={`${fmtBytes(tab.file.size)} exceeds the 1 MB inline limit. Open it on GitHub for the full source.`}
            href={ghUrl}
          />
        ) : (
          <CodeBlock content={tab.file.content ?? ''} language={tab.file.language} />
        )}
      </div>
    </>
  );
}

function CodeBlock({ content, language }: { content: string; language: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (ref.current) highlight(ref.current, language);
  }, [content, language]);
  const lines = content.split('\n');
  return (
    <pre className="m-0 flex">
      <code className="select-none whitespace-pre py-3 pl-4 pr-3 text-right text-fg-3">
        {lines.map((_, i) => (
          <span key={i} className="block">
            {i + 1}
          </span>
        ))}
      </code>
      <code
        ref={ref}
        className={`language-${language} block flex-1 whitespace-pre py-3 pl-2 pr-6 text-fg`}
      >
        {content}
      </code>
    </pre>
  );
}

function Notice({ label, detail, href }: { label: string; detail: string; href: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <span className="text-[14px] text-fg-2">{label}</span>
      <p className="max-w-md text-[11px] text-fg-3">{detail}</p>
      <a className="btn-ghost btn-sm mt-1" href={href} target="_blank" rel="noreferrer">
        Open on GitHub ↗
      </a>
    </div>
  );
}

function Breadcrumb({ segments }: { segments: string[] }) {
  return (
    <div className="min-w-0 truncate font-mono text-[12px] text-fg-2">
      {segments.map((seg, i) => (
        <span key={i}>
          {i > 0 ? <span className="px-1 text-fg-3">/</span> : null}
          <span className={i === segments.length - 1 ? 'text-fg' : ''}>{seg}</span>
        </span>
      ))}
    </div>
  );
}

/* ===================== Quick open (⌘P fuzzy) ===================== */
function QuickOpen({
  project,
  onClose,
  onOpen,
}: {
  project: Project;
  onClose: () => void;
  onOpen: (path: string) => void;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<api.FileSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);

  // Debounce + cancel-stale.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .projectSearchFiles(project.id, q.trim(), 30)
        .then((res) => {
          if (cancelled) return;
          setHits(res.results);
          setActive(0);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, q ? 120 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, project.id]);

  // Esc/↑/↓/Enter
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => (hits.length === 0 ? 0 : (i + 1) % hits.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => (hits.length === 0 ? 0 : (i - 1 + hits.length) % hits.length));
      } else if (e.key === 'Enter') {
        const pick = hits[active];
        if (pick) {
          e.preventDefault();
          onOpen(pick.path);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hits, active, onClose, onOpen]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/55 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="mt-24 w-full max-w-xl overflow-hidden rounded-xl border border-hairline bg-canvas-raised shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
          <span className="font-mono text-[10px] text-fg-3">{'>'} </span>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search files in this project…"
            className="w-full bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-3"
          />
          <span className="font-mono text-[10px] text-fg-3">esc</span>
        </div>
        <div className="max-h-[50vh] overflow-auto py-1">
          {loading ? (
            <p className="px-4 py-3 text-[12px] text-fg-3">Searching…</p>
          ) : hits.length === 0 ? (
            <p className="px-4 py-3 text-[12px] text-fg-3">
              {q ? 'No files match.' : 'Type to search.'}
            </p>
          ) : (
            <ul>
              {hits.map((h, i) => {
                const Icon = pickFileIcon(h.name);
                const dir = h.path.includes('/') ? h.path.slice(0, h.path.lastIndexOf('/')) : '';
                return (
                  <li key={h.path}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => onOpen(h.path)}
                      className={[
                        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition',
                        i === active ? 'bg-accent-soft text-fg' : 'text-fg-2 hover:bg-sheen/[0.04]',
                      ].join(' ')}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0 text-fg-3" />
                      <span className="font-mono">{h.name}</span>
                      {dir ? (
                        <span className="truncate text-[11px] text-fg-3">{dir}</span>
                      ) : null}
                      <span className="ml-auto pl-2 text-[10px] text-fg-3">{fmtBytes(h.size)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-hairline px-3 py-1.5 font-mono text-[10px] text-fg-3">
          <span>↑↓ navigate · ↵ open · esc close</span>
          <span>{hits.length} hit{hits.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
  );
}

/* ============================== icons ============================== */
type IconProps = { className?: string };

function FolderIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}
function FolderOpenIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3z" />
      <path d="M3 9h18l-2 8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}
function FileIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
    </svg>
  );
}
function MdIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 15V9l3 3 3-3v6" />
      <path d="M17 9v6m-2-2 2 2 2-2" />
    </svg>
  );
}
function TsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 12h5" />
      <path d="M11 12v5" />
      <path d="M16 17c0 1 1 1.5 2 1.5s2-.5 2-1.5-2-1-2-2 1-1.5 2-1.5" />
    </svg>
  );
}
function JsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M11 13v3a2 2 0 0 1-4 0" />
      <path d="M17 13c-1.5 0-3 .5-3 2s3 1 3 2.5-1.5 1.5-3 1" />
    </svg>
  );
}
function JsonIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9 4c-2 0-3 1-3 3v2c0 1-1 2-2 2 1 0 2 1 2 2v2c0 2 1 3 3 3" />
      <path d="M15 4c2 0 3 1 3 3v2c0 1 1 2 2 2-1 0-2 1-2 2v2c0 2-1 3-3 3" />
    </svg>
  );
}
function CssIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 8h10" />
      <path d="M7 12h10" />
      <path d="M7 16h6" />
    </svg>
  );
}
function HtmlIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m4 4 2 16 6 2 6-2 2-16z" />
      <path d="M8 9h8l-.5 4-3.5 1-3.5-1" />
    </svg>
  );
}
function YmlIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 9h2l1 3 1-3h2" />
      <path d="M10 12v3" />
      <path d="M15 9v3a1 1 0 0 0 1 1h1" />
    </svg>
  );
}
function ShIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="m7 10 3 2-3 2" />
      <path d="M12 16h5" />
    </svg>
  );
}
function CodeFileIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
      <path d="m9 14-2 2 2 2" />
      <path d="m15 14 2 2-2 2" />
    </svg>
  );
}
function ImgIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="m4 19 5-6 4 4 3-3 4 4" />
    </svg>
  );
}
function LockIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 1 1 8 0v3" />
    </svg>
  );
}
function Caret() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-2.5 w-2.5">
      <path d="m9 6 6 6-6 6z" />
    </svg>
  );
}
function Spinner() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3 w-3 animate-spin">
      <path d="M12 4a8 8 0 0 1 8 8" />
    </svg>
  );
}

function pickFileIcon(name: string): (p: IconProps) => ReactElement {
  const lower = name.toLowerCase();
  if (lower === 'dockerfile' || lower.endsWith('.dockerfile')) return ShIcon;
  if (lower === 'makefile') return ShIcon;
  if (lower.startsWith('.env')) return LockIcon;
  if (lower.endsWith('.lock') || lower === 'pnpm-lock.yaml' || lower === 'package-lock.json')
    return LockIcon;
  if (lower.endsWith('.md') || lower.endsWith('.mdx')) return MdIcon;
  if (lower.endsWith('.tsx') || lower.endsWith('.ts')) return TsIcon;
  if (lower.endsWith('.jsx') || lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs'))
    return JsIcon;
  if (lower.endsWith('.json') || lower.endsWith('.jsonc')) return JsonIcon;
  if (lower.endsWith('.css') || lower.endsWith('.scss') || lower.endsWith('.sass') || lower.endsWith('.less'))
    return CssIcon;
  if (lower.endsWith('.html') || lower.endsWith('.htm') || lower.endsWith('.svg') || lower.endsWith('.xml'))
    return HtmlIcon;
  if (lower.endsWith('.yml') || lower.endsWith('.yaml') || lower.endsWith('.toml') || lower.endsWith('.ini'))
    return YmlIcon;
  if (lower.endsWith('.sh') || lower.endsWith('.bash') || lower.endsWith('.zsh')) return ShIcon;
  if (/\.(png|jpe?g|gif|webp|ico|bmp|tiff?)$/.test(lower)) return ImgIcon;
  if (
    /\.(py|go|rs|rb|php|java|kt|swift|c|cpp|cc|h|hpp|sql|prisma|graphql|gql)$/.test(lower)
  )
    return CodeFileIcon;
  return FileIcon;
}

function basename(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx === -1 ? p : p.slice(idx + 1);
}

function humanize(err: unknown): string {
  const status = (err as { status?: number }).status;
  const body = (err as { body?: { error?: string } }).body;
  if (status === 409 && body?.error === 'clone_missing') {
    return 'This project has no local clone. Connect via /projects again.';
  }
  if (status === 409 && body?.error === 'clone_missing_on_disk') {
    return 'The clone path is missing on disk. The repo may have been removed locally.';
  }
  if (status === 400 && body?.error === 'path_escape') {
    return 'Path escaped the project root.';
  }
  return err instanceof Error ? err.message : 'Request failed';
}
