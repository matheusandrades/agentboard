/**
 * VSCode-style file browser for a connected project.
 *
 *  ┌────────────────┬──────────────────────────────────────────┐
 *  │ tree (lazy)    │ breadcrumb · open in github              │
 *  │                │ ──────────────────────────────────────── │
 *  │  ▸ apps        │ syntax-highlighted file                  │
 *  │  ▸ packages    │ (read-only, line numbers)                │
 *  │    README.md   │                                          │
 *  └────────────────┴──────────────────────────────────────────┘
 *
 * Lazy-loads each folder only when the user expands it. Files larger than
 * 1 MB or detected binaries get a friendly placeholder — no half-megabyte
 * blobs in the React tree.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function FileBrowser({ project }: Props) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [rootLoading, setRootLoading] = useState(true);
  const [rootError, setRootError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [file, setFile] = useState<api.FileResponse | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  /* -------------------- root -------------------- */
  useEffect(() => {
    let cancelled = false;
    setRootLoading(true);
    setRootError(null);
    setTree([]);
    setSelected(null);
    setFile(null);
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
      // Walk + immutably patch the path of nodes by `target.path`.
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

      // Collapse if already expanded.
      if (target.expanded) {
        setTree((cur) =>
          patch(cur, (n) => {
            n.expanded = false;
            return n;
          }),
        );
        return;
      }

      // Expand. If we already have children, just flip the flag.
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
        setFileError(humanize(err));
      }
    },
    [project.id],
  );

  /* -------- load a file when selected -------- */
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setFileLoading(true);
    setFileError(null);
    setFile(null);
    api
      .projectFile(project.id, selected)
      .then((res) => {
        if (!cancelled) setFile(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setFileError(humanize(err));
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, project.id]);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr] overflow-hidden">
      {/* Tree */}
      <aside className="min-h-0 overflow-auto border-r border-hairline bg-canvas-sunken/40 py-1.5 font-mono text-[12px]">
        {rootLoading ? (
          <p className="px-3 py-2 text-fg-3">Loading…</p>
        ) : rootError ? (
          <p className="px-3 py-2 text-err">{rootError}</p>
        ) : (
          <NodeList
            nodes={tree}
            depth={0}
            selected={selected}
            onSelect={setSelected}
            onToggle={toggleDir}
          />
        )}
      </aside>

      {/* Reader */}
      <section className="flex min-h-0 flex-col">
        {selected ? (
          <FileReader
            project={project}
            path={selected}
            file={file}
            loading={fileLoading}
            error={fileError}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center text-fg-3">
            <span className="text-[14px] text-fg-2">Pick a file from the tree</span>
            <p className="max-w-xs text-[11px]">
              Files come from the project's local clone at{' '}
              <code className="rounded bg-sheen/[0.06] px-1 font-mono">
                {project.clonePath ?? '—'}
              </code>
              .
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

/* ------------------------------ tree row ----------------------------- */
function NodeList({
  nodes,
  depth,
  selected,
  onSelect,
  onToggle,
}: {
  nodes: TreeNode[];
  depth: number;
  selected: string | null;
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
            selected={selected === n.path}
            onSelect={() => onSelect(n.path)}
            onToggle={() => onToggle(n)}
          />
          {n.expanded && n.children ? (
            <NodeList
              nodes={n.children}
              depth={depth + 1}
              selected={selected}
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

/* ----------------------------- file viewer --------------------------- */
function FileReader({
  project,
  path,
  file,
  loading,
  error,
}: {
  project: Project;
  path: string;
  file: api.FileResponse | null;
  loading: boolean;
  error: string | null;
}) {
  const segments = path.split('/');
  const ghUrl = useMemo(() => {
    const branch = project.defaultBranch || 'main';
    return `https://github.com/${project.repoOwner}/${project.repoName}/blob/${encodeURIComponent(branch)}/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;
  }, [project, path]);

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-hairline px-4 py-2">
        <Breadcrumb segments={segments} />
        <span className="ml-auto inline-flex items-center gap-2 font-mono text-[11px] text-fg-3">
          {file && file.encoding === 'utf8' ? (
            <>
              <span>{file.language}</span>
              <span>·</span>
              <span>{fmtBytes(file.size)}</span>
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
        {error ? (
          <p className="px-4 py-3 text-err">{error}</p>
        ) : loading || !file ? (
          <p className="px-4 py-3 text-fg-3">Loading…</p>
        ) : file.encoding === 'binary' ? (
          <Notice
            label="Binary file"
            detail={`This file looks like binary data (${fmtBytes(file.size)}). Open it on GitHub to view.`}
            href={ghUrl}
          />
        ) : file.encoding === 'too-large' ? (
          <Notice
            label="File is too big to show"
            detail={`${fmtBytes(file.size)} exceeds the 1 MB inline limit. Open it on GitHub for the full source.`}
            href={ghUrl}
          />
        ) : (
          <CodeBlock content={file.content ?? ''} language={file.language} />
        )}
      </div>
    </>
  );
}

function CodeBlock({ content, language }: { content: string; language: string }) {
  const ref = useRef<HTMLElement>(null);
  // Highlight after every render so ⇧ between files reuses the same node.
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
      <a
        className="btn-ghost btn-sm mt-1"
        href={href}
        target="_blank"
        rel="noreferrer"
      >
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

/* ------------------------------- icons ------------------------------- */
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

function pickFileIcon(name: string): (p: IconProps) => JSX.Element {
  const lower = name.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.mdx')) return MdIcon;
  if (
    /\.(ts|tsx|js|jsx|mjs|cjs|json|jsonc|css|scss|sass|less|html|svg|xml|yaml|yml|toml|sh|bash|py|go|rs|rb|php|java|kt|swift|c|cpp|h|hpp|sql)$/.test(
      lower,
    )
  )
    return CodeFileIcon;
  return FileIcon;
}

/* ---------------------- error humaniser ---------------------- */
function humanize(err: unknown): string {
  const status = (err as { status?: number }).status;
  const body = (err as { body?: { error?: string } }).body;
  if (status === 409 && body?.error === 'clone_missing') {
    return 'This project has no local clone. Connect via /projects again.';
  }
  if (status === 409 && body?.error === 'clone_missing_on_disk') {
    return "The clone path is missing on disk. The repo may have been removed locally.";
  }
  if (status === 400 && body?.error === 'path_escape') {
    return 'Path escaped the project root.';
  }
  return err instanceof Error ? err.message : 'Request failed';
}
