import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { FileBrowser } from '@/components/FileBrowser';
import { useBoardStore } from '@/lib/store';
import { relativeTime } from '@/lib/time';
import * as api from '@/lib/api';
import type {
  BranchSummary,
  IssueSummary,
  ProjectDetail as ProjectDetailType,
  PullRequestSummary,
} from '@/lib/types';

type Tab = 'files' | 'tasks' | 'pulls' | 'issues' | 'branches' | 'overview';

export function ProjectDetail() {
  const { id = '' } = useParams();
  const agents = useBoardStore((s) => s.agents);
  const [project, setProject] = useState<ProjectDetailType | null>(null);
  // Files-first: when a user clicks a project, they almost always want to
  // see the code, not a stats overview.
  const [tab, setTab] = useState<Tab>('files');
  const [pulls, setPulls] = useState<PullRequestSummary[]>([]);
  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [tabLoading, setTabLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pullState, setPullState] = useState<'open' | 'closed' | 'all'>('all');
  const [issueState, setIssueState] = useState<'open' | 'closed' | 'all'>('open');
  const [importing, setImporting] = useState<number | null>(null);

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  async function refresh() {
    try {
      const p = await api.getProject(id);
      setProject(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, [id]);

  // Fetch the active tab's data on demand.
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    setTabLoading(true);
    (async () => {
      try {
        if (tab === 'overview' || tab === 'pulls') {
          const ps = await api.projectPulls(id, tab === 'pulls' ? pullState : 'all');
          if (!cancelled) setPulls(ps);
        }
        if (tab === 'overview' || tab === 'issues') {
          const is = await api.projectIssues(id, tab === 'issues' ? issueState : 'open');
          if (!cancelled) setIssues(is);
        }
        if (tab === 'branches') {
          const bs = await api.projectBranches(id);
          if (!cancelled) setBranches(bs);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed');
      } finally {
        if (!cancelled) setTabLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project, tab, id, pullState, issueState]);

  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader eyebrow="Project" title="Loading…" />
      </div>
    );
  }
  if (!project) {
    return (
      <div className="p-8 text-[13px] text-fg-2">
        Project not found.{' '}
        <Link to="/projects" className="text-accent hover:underline">
          Back
        </Link>
      </div>
    );
  }

  const repoUrl = `https://github.com/${project.repoOwner}/${project.repoName}`;

  const openPRs = pulls.filter((p) => p.state === 'OPEN');
  const failingPRs = openPRs.filter((p) => p.checks === 'FAILURE');
  const draftPRs = openPRs.filter((p) => p.isDraft);
  const openIssues = issues.filter((i) => i.state === 'OPEN');

  const tabCounts: Record<Tab, number | null> = {
    files: null,
    tasks: project.tasks.length,
    pulls: openPRs.length,
    issues: openIssues.length,
    branches: branches.length || null,
    overview: null,
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Hero header — clear breadcrumb + identity + repo metadata */}
      <header className="shrink-0 border-b border-hairline px-6 pb-3 pt-4">
        <nav className="flex items-center gap-1 text-[11px] text-fg-3">
          <Link to="/projects" className="hover:text-fg">
            Projects
          </Link>
          <span>/</span>
          <span className="text-fg-2">{project.repoOwner}</span>
          <span>/</span>
          <span className="text-fg">{project.repoName}</span>
        </nav>
        <div className="mt-1 flex items-end justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[20px] font-semibold tracking-tight text-fg">
              {project.name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
              <span
                className={['pill', project.visibility === 'public' ? 'pill-ok' : ''].join(' ')}
              >
                {project.visibility}
              </span>
              <span className="pill">{project.defaultBranch}</span>
              {project.description ? (
                <span className="truncate text-fg-2">· {project.description}</span>
              ) : null}
              <a
                href={repoUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-auto text-fg-3 hover:text-fg"
              >
                {project.repoOwner}/{project.repoName} ↗
              </a>
            </div>
          </div>
          <button
            type="button"
            className="btn-ghost btn-sm shrink-0"
            onClick={refresh}
            title="Refresh"
          >
            ↻
          </button>
        </div>

        {/* Tab rail — its own row, scrolls horizontally on overflow */}
        <nav className="-mx-6 mt-3 flex items-center gap-0 overflow-x-auto border-t border-hairline px-6 pt-1.5 [scrollbar-width:thin]">
          {(['files', 'tasks', 'pulls', 'issues', 'branches', 'overview'] as Tab[]).map((t) => (
            <Tabber
              key={t}
              active={tab === t}
              onClick={() => setTab(t)}
              label={tabLabel(t)}
              count={tabCounts[t]}
            />
          ))}
        </nav>
      </header>

      {error ? (
        <div className="border-b border-err/40 bg-err-soft px-6 py-2 text-[12px] text-err">
          {error}
        </div>
      ) : null}

      {/* Files tab takes the full pane (no padding/scroll wrapper) */}
      {tab === 'files' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <FileBrowser project={project} />
        </div>
      ) : null}

      {tab !== 'files' ? (
        <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        {tab === 'overview' ? (
          <Overview
            project={project}
            openPRs={openPRs.length}
            failingPRs={failingPRs.length}
            draftPRs={draftPRs.length}
            openIssues={openIssues.length}
            recentPRs={openPRs.slice(0, 5)}
            recentIssues={openIssues.slice(0, 5)}
          />
        ) : null}

        {tab === 'pulls' ? (
          <PullsTab
            pulls={pulls}
            state={pullState}
            setState={setPullState}
            loading={tabLoading}
          />
        ) : null}

        {tab === 'issues' ? (
          <IssuesTab
            issues={issues}
            state={issueState}
            setState={setIssueState}
            loading={tabLoading}
            agents={agents}
            onImport={async (issue, assigneeId) => {
              setImporting(issue.number);
              try {
                await api.importIssue(id, issue.number, assigneeId);
                // Re-pull issues to update count, refresh tasks
                const [is, p] = await Promise.all([
                  api.projectIssues(id, issueState),
                  api.getProject(id),
                ]);
                setIssues(is);
                setProject(p);
              } catch (err) {
                alert(err instanceof Error ? err.message : 'Import failed');
              } finally {
                setImporting(null);
              }
            }}
            importing={importing}
          />
        ) : null}

        {tab === 'branches' ? (
          <BranchesTab
            branches={branches}
            loading={tabLoading}
            project={project}
          />
        ) : null}

        {tab === 'tasks' ? (
          <TasksTab project={project} agentById={agentById} />
        ) : null}
        </div>
      ) : null}
    </div>
  );
}

function tabLabel(t: Tab): string {
  switch (t) {
    case 'overview':
      return 'Overview';
    case 'files':
      return 'Files';
    case 'pulls':
      return 'Pulls';
    case 'issues':
      return 'Issues';
    case 'branches':
      return 'Branches';
    case 'tasks':
      return 'Tasks';
  }
}

/* ─────────────────────── Overview ────────────────────────────── */
function Overview({
  project,
  openPRs,
  failingPRs,
  draftPRs,
  openIssues,
  recentPRs,
  recentIssues,
}: {
  project: ProjectDetailType;
  openPRs: number;
  failingPRs: number;
  draftPRs: number;
  openIssues: number;
  recentPRs: PullRequestSummary[];
  recentIssues: IssueSummary[];
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open PRs" value={openPRs} hint={draftPRs > 0 ? `${draftPRs} draft` : undefined} />
        <Stat
          label="Failing checks"
          value={failingPRs}
          tone={failingPRs > 0 ? 'err' : 'fg'}
        />
        <Stat label="Open issues" value={openIssues} />
        <Stat label="Tasks attached" value={project.tasks.length} />
      </div>

      <section>
        <h3 className="eyebrow mb-2">Recent open PRs</h3>
        {recentPRs.length === 0 ? (
          <p className="text-[12px] text-fg-3">No open pull requests.</p>
        ) : (
          <ul className="divide-y divide-hairline rounded-xl border border-hairline bg-sheen/[0.02]">
            {recentPRs.map((p) => (
              <li key={p.number} className="px-4 py-2 hover:bg-sheen/[0.03]">
                <PullRow pr={p} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="eyebrow mb-2">Recent open issues</h3>
        {recentIssues.length === 0 ? (
          <p className="text-[12px] text-fg-3">No open issues.</p>
        ) : (
          <ul className="divide-y divide-hairline rounded-xl border border-hairline bg-sheen/[0.02]">
            {recentIssues.map((i) => (
              <li key={i.number} className="px-4 py-2 hover:bg-sheen/[0.03]">
                <IssueRow issue={i} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: 'fg' | 'err' | 'warn' | 'ok';
}) {
  const cls = tone === 'err' ? 'text-err' : tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : 'text-fg';
  return (
    <div className="rounded-xl border border-hairline bg-sheen/[0.02] p-4">
      <span className="eyebrow block">{label}</span>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={['text-[28px] tnum tracking-tight', cls].join(' ')}>{value}</span>
        {hint ? <span className="text-[11px] text-fg-3">{hint}</span> : null}
      </div>
    </div>
  );
}

/* ─────────────────────── Pulls ────────────────────────────── */
function PullsTab({
  pulls,
  state,
  setState,
  loading,
}: {
  pulls: PullRequestSummary[];
  state: 'open' | 'closed' | 'all';
  setState: (s: 'open' | 'closed' | 'all') => void;
  loading: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {(['open', 'closed', 'all'] as const).map((s) => (
          <Tabber key={s} active={state === s} onClick={() => setState(s)} label={s} />
        ))}
        <span className="ml-auto text-[11px] text-fg-3">
          {loading ? 'Loading…' : `${pulls.length} pulls`}
        </span>
      </div>
      {pulls.length === 0 ? (
        <p className="text-[12px] text-fg-3">No pull requests for this filter.</p>
      ) : (
        <ul className="divide-y divide-hairline rounded-xl border border-hairline bg-sheen/[0.02]">
          {pulls.map((p) => (
            <li key={p.number} className="px-4 py-3 hover:bg-sheen/[0.03]">
              <PullRow pr={p} expanded />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PullRow({ pr, expanded }: { pr: PullRequestSummary; expanded?: boolean }) {
  return (
    <a href={pr.url} target="_blank" rel="noreferrer" className="block">
      <div className="flex items-center gap-2">
        <StateBadge state={pr.state} draft={pr.isDraft} />
        <span className="font-mono text-[11px] text-fg-3 tnum">#{pr.number}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{pr.title}</span>
        <ChecksBadge checks={pr.checks} />
        {pr.reviewDecision === 'APPROVED' ? <span className="pill pill-ok">approved</span> : null}
        {pr.reviewDecision === 'CHANGES_REQUESTED' ? (
          <span className="pill pill-err">changes</span>
        ) : null}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-fg-3 font-mono">
        <span>{pr.author}</span>
        <span>·</span>
        <span title={`${pr.headRefName} → ${pr.baseRefName}`}>
          {pr.headRefName} → {pr.baseRefName}
        </span>
        <span>·</span>
        <span className="text-ok">+{pr.additions}</span>
        <span className="text-err">−{pr.deletions}</span>
        <span>·</span>
        <span>{pr.changedFiles} files</span>
        <span>·</span>
        <span>updated {relativeTime(pr.updatedAt)}</span>
        {pr.labels.length > 0 ? (
          <>
            <span>·</span>
            <span className="space-x-1">
              {pr.labels.slice(0, 3).map((l) => (
                <span key={l} className="pill text-[9px]">
                  {l}
                </span>
              ))}
            </span>
          </>
        ) : null}
      </div>
      {expanded && pr.headRefName.startsWith('agent/') ? (
        <p className="mt-1 text-[10px] text-violet-bright">opened by an AgentBoard agent</p>
      ) : null}
    </a>
  );
}

function StateBadge({ state, draft }: { state: PullRequestSummary['state']; draft: boolean }) {
  if (draft) return <span className="pill text-fg-3">draft</span>;
  if (state === 'MERGED') return <span className="pill" style={{ color: '#b388ff', borderColor: '#b388ff66' }}>merged</span>;
  if (state === 'CLOSED') return <span className="pill pill-err">closed</span>;
  return <span className="pill pill-ok">open</span>;
}

function ChecksBadge({ checks }: { checks: PullRequestSummary['checks'] }) {
  if (checks === 'SUCCESS') return <span className="pill pill-ok">✓ checks</span>;
  if (checks === 'FAILURE') return <span className="pill pill-err">✗ checks</span>;
  if (checks === 'PENDING') return <span className="pill pill-warn">… checks</span>;
  return null;
}

/* ─────────────────────── Issues ────────────────────────────── */
function IssuesTab({
  issues,
  state,
  setState,
  loading,
  agents,
  onImport,
  importing,
}: {
  issues: IssueSummary[];
  state: 'open' | 'closed' | 'all';
  setState: (s: 'open' | 'closed' | 'all') => void;
  loading: boolean;
  agents: ReturnType<typeof useBoardStore.getState>['agents'];
  onImport: (issue: IssueSummary, assigneeId: string | null) => Promise<void>;
  importing: number | null;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {(['open', 'closed', 'all'] as const).map((s) => (
          <Tabber key={s} active={state === s} onClick={() => setState(s)} label={s} />
        ))}
        <span className="ml-auto text-[11px] text-fg-3">
          {loading ? 'Loading…' : `${issues.length} issues`}
        </span>
      </div>
      {issues.length === 0 ? (
        <p className="text-[12px] text-fg-3">No issues for this filter.</p>
      ) : (
        <ul className="divide-y divide-hairline rounded-xl border border-hairline bg-sheen/[0.02]">
          {issues.map((i) => (
            <li key={i.number} className="px-4 py-3 hover:bg-sheen/[0.03]">
              <IssueRow issue={i} />
              <div className="mt-2 flex items-center gap-2">
                <select
                  className="input py-1 text-[11px]"
                  defaultValue=""
                  id={`assignee-${i.number}`}
                >
                  <option value="">→ alice-pm (default)</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.role}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    const sel = document.getElementById(
                      `assignee-${i.number}`,
                    ) as HTMLSelectElement | null;
                    void onImport(i, sel?.value || null);
                  }}
                  disabled={importing === i.number || i.state === 'CLOSED'}
                >
                  {importing === i.number ? 'Importing…' : '＋ Import as task'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function IssueRow({ issue }: { issue: IssueSummary }) {
  return (
    <a href={issue.url} target="_blank" rel="noreferrer" className="block">
      <div className="flex items-center gap-2">
        {issue.state === 'OPEN' ? (
          <span className="pill pill-ok">open</span>
        ) : (
          <span className="pill text-fg-3">closed</span>
        )}
        <span className="font-mono text-[11px] text-fg-3 tnum">#{issue.number}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{issue.title}</span>
        {issue.comments > 0 ? (
          <span className="pill text-[10px]" title="comments">{issue.comments} comments</span>
        ) : null}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-fg-3 font-mono">
        <span>{issue.author}</span>
        <span>·</span>
        <span>updated {relativeTime(issue.updatedAt)}</span>
        {issue.assignees.length > 0 ? (
          <>
            <span>·</span>
            <span>assigned: {issue.assignees.join(', ')}</span>
          </>
        ) : null}
        {issue.labels.length > 0 ? (
          <>
            <span>·</span>
            <span className="space-x-1">
              {issue.labels.slice(0, 4).map((l) => (
                <span key={l} className="pill text-[9px]">
                  {l}
                </span>
              ))}
            </span>
          </>
        ) : null}
      </div>
    </a>
  );
}

/* ─────────────────────── Branches ────────────────────────────── */
function BranchesTab({
  branches,
  loading,
  project,
}: {
  branches: BranchSummary[];
  loading: boolean;
  project: ProjectDetailType;
}) {
  if (loading) return <p className="text-[12px] text-fg-3">Loading branches…</p>;
  if (branches.length === 0) return <p className="text-[12px] text-fg-3">No branches found.</p>;
  return (
    <ul className="divide-y divide-hairline rounded-xl border border-hairline bg-sheen/[0.02]">
      {branches.map((b) => {
        const isAgentBranch = b.name.startsWith('agent/');
        return (
          <li key={b.name} className="px-4 py-3 hover:bg-sheen/[0.03]">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[12px] text-fg">{b.name}</span>
              {b.isProtected ? <span className="pill text-warn">protected</span> : null}
              {isAgentBranch ? <span className="pill pill-violet">agent</span> : null}
              <a
                href={`https://github.com/${project.repoOwner}/${project.repoName}/tree/${b.name}`}
                target="_blank"
                rel="noreferrer"
                className="ml-auto text-[10px] text-accent hover:underline"
              >
                ↗
              </a>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-fg-3 font-mono">
              <span className="text-violet-bright tnum">{b.commitSha}</span>
              <span className="truncate text-fg">{b.commitMessage}</span>
              <span>·</span>
              <span>{b.commitAuthor}</span>
              <span>·</span>
              <span>{relativeTime(b.commitDate)}</span>
              {!b.isProtected ? (
                <>
                  <span>·</span>
                  <span className="text-ok">+{b.aheadOfDefault} ahead</span>
                  <span className="text-err">−{b.behindDefault} behind</span>
                </>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ─────────────────────── Tasks ────────────────────────────── */
function TasksTab({
  project,
  agentById,
}: {
  project: ProjectDetailType;
  agentById: Map<string, ReturnType<typeof useBoardStore.getState>['agents'][number]>;
}) {
  if (project.tasks.length === 0)
    return (
      <p className="text-[12px] text-fg-3">
        No tasks bound to this project yet. Import an issue or create one from the chat.
      </p>
    );
  return (
    <ul className="divide-y divide-hairline rounded-xl border border-hairline bg-sheen/[0.02]">
      {project.tasks.map((t) => {
        const a = t.assigneeId ? agentById.get(t.assigneeId) : null;
        return (
          <li key={t.id} className="px-4 py-3 hover:bg-sheen/[0.03]">
            <div className="flex items-center gap-2">
              <span
                className={[
                  'pill text-[10px]',
                  t.status === 'done' ? 'pill-ok' : t.status === 'review' ? 'pill-violet' : '',
                ].join(' ')}
              >
                {t.status}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{t.title}</span>
              {t.prUrl ? (
                <a href={t.prUrl} target="_blank" rel="noreferrer" className="pill pill-ok">
                  PR #{t.prNumber}
                </a>
              ) : null}
            </div>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-fg-3 font-mono">
              {a ? <span>{a.name}</span> : null}
              {t.branch ? (
                <>
                  <span>·</span>
                  <span>⎇ {t.branch}</span>
                </>
              ) : null}
              <span>·</span>
              <span>{relativeTime(t.updatedAt)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ─────────────────────── shared ────────────────────────────── */
function Tabber({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'group relative inline-flex shrink-0 items-center gap-1.5 px-3 py-2 text-[12.5px] capitalize transition',
        active ? 'text-fg' : 'text-fg-3 hover:text-fg',
      ].join(' ')}
    >
      <span>{label}</span>
      {typeof count === 'number' && count > 0 ? (
        <span
          className={[
            'rounded-md px-1 font-mono text-[10px] tnum',
            active ? 'bg-accent/15 text-accent' : 'bg-sheen/[0.06] text-fg-3',
          ].join(' ')}
        >
          {count}
        </span>
      ) : null}
      {active ? (
        <span className="absolute inset-x-2 -bottom-px h-0.5 bg-accent" aria-hidden />
      ) : null}
    </button>
  );
}
