import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Agent, Message, Preview, Project, Task, TaskStatus } from '@/lib/types';
import { AgentAvatar } from './AgentAvatar';
import { MessageBubble } from './MessageBubble';
import { useBoardStore } from '@/lib/store';
import { ROLE_TINT } from '@/lib/roles';
import { relativeTime } from '@/lib/time';
import * as api from '@/lib/api';

interface Props {
  task: Task;
  onClose: () => void;
}

const STATUS_OPTIONS: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'review', 'done'];
const PRIORITY_LABEL: Record<number, { label: string; tone: string }> = {
  1: { label: 'P1 · Urgent', tone: 'text-err' },
  2: { label: 'P2 · High', tone: 'text-warn' },
  3: { label: 'P3 · Normal', tone: 'text-fg-2' },
  4: { label: 'P4 · Low', tone: 'text-fg-3' },
  5: { label: 'P5 · Later', tone: 'text-fg-3' },
};

export function TaskDetailDialog({ task, onClose }: Props) {
  const agents = useBoardStore((s) => s.agents);
  const messages = useBoardStore((s) => s.messages);
  const commits = useBoardStore((s) => s.commits);
  const setTasks = useBoardStore((s) => s.setTasks);
  const tasks = useBoardStore((s) => s.tasks);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [previewRefreshing, setPreviewRefreshing] = useState(false);

  async function refreshPreviews() {
    setPreviewRefreshing(true);
    try {
      const all = await api.listPreviews();
      setPreviews(all.filter((p) => p.taskId === task.id));
    } catch {
      /* ignore */
    } finally {
      setPreviewRefreshing(false);
    }
  }

  useEffect(() => {
    void refreshPreviews();
    const t = setInterval(refreshPreviews, 8000);
    return () => clearInterval(t);
  }, [task.id]);

  async function stopOnePreview(id: string) {
    try {
      await api.stopPreview(id);
      await refreshPreviews();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Stop failed');
    }
  }

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [assigneeId, setAssigneeId] = useState<string | null>(task.assigneeId);
  const [projectId, setProjectId] = useState<string | null>(task.projectId ?? null);
  const [priority, setPriority] = useState<number>(task.priority);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    void api
      .listProjects()
      .then(setProjects)
      .catch(() => undefined);
  }, []);

  const project = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  );

  const assignee = useMemo(
    () => (assigneeId ? agents.find((a) => a.id === assigneeId) : null),
    [agents, assigneeId],
  );

  const relatedMessages = useMemo(
    () =>
      messages
        .filter((m) => m.taskId === task.id)
        .slice()
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [messages, task.id],
  );

  const relatedCommits = useMemo(
    () =>
      commits
        .filter((c) => c.taskId === task.id)
        .slice()
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [commits, task.id],
  );

  const dirty =
    title !== task.title ||
    description !== (task.description ?? '') ||
    status !== task.status ||
    assigneeId !== task.assigneeId ||
    projectId !== (task.projectId ?? null) ||
    priority !== task.priority;

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  async function save() {
    if (saving || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateTask(task.id, {
        title,
        description: description.trim() ? description : null,
        status,
        assigneeId,
        projectId,
        priority,
      });
      setTasks(tasks.map((t) => (t.id === updated.id ? updated : t)));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (deleting) return;
    if (!confirm(`Delete task "${task.title}"?`)) return;
    setDeleting(true);
    try {
      // Backend doesn't expose DELETE /api/tasks/:id yet — soft approach is
      // to mark it done with a [deleted] prefix. Skip for now and warn.
      alert('Task deletion is not implemented yet. Drag to "Done" to archive.');
    } finally {
      setDeleting(false);
    }
  }

  const priorityMeta = PRIORITY_LABEL[priority] ?? PRIORITY_LABEL[3]!;
  const createdByAgent = task.createdBy ? agents.find((a) => a.id === task.createdBy) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="relative flex w-full max-w-2xl flex-col border-l border-hairline bg-canvas-raised shadow-glass-lg animate-sheet-in"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <header className="sticky top-0 z-10 shrink-0 border-b border-hairline bg-canvas-raised/80 px-8 pb-5 pt-8 backdrop-blur-xl">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-5 top-5 btn-icon"
            aria-label="Close"
          >
            ✕
          </button>
          <div className="flex items-center gap-3">
            <span className="eyebrow">Task</span>
            <span className="font-mono text-[10px] text-fg-3 tnum">{task.id.slice(0, 8)}</span>
            <span className={['font-mono text-[11px]', priorityMeta.tone].join(' ')}>
              {priorityMeta.label}
            </span>
          </div>
          <input
            className="mt-2 w-full border-0 bg-transparent p-0 text-display-md font-medium tracking-tight text-fg focus:ring-0"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title"
          />
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-6">
          {/* Meta row */}
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Status">
              <select
                className="input py-1.5"
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Assignee">
              <select
                className="input py-1.5"
                value={assigneeId ?? ''}
                onChange={(e) => setAssigneeId(e.target.value || null)}
              >
                <option value="">— unassigned —</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.role}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Priority">
              <select
                className="input py-1.5"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
              >
                {[1, 2, 3, 4, 5].map((p) => (
                  <option key={p} value={p}>
                    P{p}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {/* Project / branch / PR */}
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <Field label="Project">
              <select
                className="input py-1.5"
                value={projectId ?? ''}
                onChange={(e) => setProjectId(e.target.value || null)}
              >
                <option value="">— none —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.repoOwner}/{p.repoName}
                  </option>
                ))}
              </select>
            </Field>
            {project ? (
              <div className="rounded-xl border border-hairline bg-sheen/[0.03] px-3 py-2">
                <span className="eyebrow block">Branch / PR</span>
                <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-fg">
                  {task.branch ? (
                    <a
                      href={`https://github.com/${project.repoOwner}/${project.repoName}/tree/${task.branch}`}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate hover:underline"
                      title={task.branch}
                    >
                      {task.branch}
                    </a>
                  ) : (
                    <span className="text-fg-3">(not checked out yet)</span>
                  )}
                </div>
                {task.prUrl ? (
                  <a
                    href={task.prUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
                  >
                    PR #{task.prNumber} ↗
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Assignee card preview */}
          {assignee ? <AssigneeBadge agent={assignee} /> : null}

          {/* Description */}
          <label className="mt-6 flex flex-col gap-1.5">
            <span className="eyebrow">Description</span>
            <textarea
              className="textarea min-h-[140px]"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="(no description)"
            />
          </label>

          {/* Timeline */}
          <aside className="mt-6 grid gap-3 sm:grid-cols-2">
            <InfoLine label="Created" value={`${relativeTime(task.createdAt)} by ${createdByAgent?.name ?? 'stakeholder'}`} />
            <InfoLine label="Last update" value={relativeTime(task.updatedAt)} />
          </aside>

          {/* Preview containers */}
          {previews.length > 0 ? (
            <section className="mt-8">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="eyebrow">Preview · {previews.length}</h4>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={refreshPreviews}
                  disabled={previewRefreshing}
                >
                  {previewRefreshing ? 'Refreshing…' : '↻ Refresh'}
                </button>
              </div>
              <ul className="space-y-2">
                {previews.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center gap-3 rounded-xl border border-hairline bg-sheen/[0.03] px-3 py-2"
                  >
                    <span
                      className={[
                        'h-2 w-2 rounded-full',
                        p.status === 'running' ? 'bg-ok animate-breath' : 'bg-fg-3',
                      ].join(' ')}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium text-fg">{p.name}</span>
                        <span className="pill tnum">:{p.hostPort}</span>
                        {p.service ? <span className="pill">{p.service}</span> : null}
                      </div>
                      <div className="text-[11px] text-fg-3 font-mono">
                        {p.containerId ? p.containerId.slice(0, 12) : '—'}
                        {p.projectName ? ` · ${p.projectName}` : ''}
                      </div>
                    </div>
                    {p.status === 'running' ? (
                      <>
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-sm"
                        >
                          Open ↗
                        </a>
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          onClick={() => stopOnePreview(p.id)}
                          title="Stop container"
                        >
                          Stop
                        </button>
                      </>
                    ) : (
                      <span className="text-[11px] text-fg-3">stopped</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Related commits */}
          {relatedCommits.length > 0 ? (
            <section className="mt-8">
              <h4 className="eyebrow mb-2">Commits · {relatedCommits.length}</h4>
              <ul className="divide-y divide-hairline rounded-xl border border-hairline bg-sheen/[0.02]">
                {relatedCommits.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-2">
                    <Link to={`/commits?focus=${c.id}`} className="font-mono text-[11px] text-violet-bright tnum hover:underline">
                      {c.sha.slice(0, 7)}
                    </Link>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{c.message}</span>
                    <span className="shrink-0 text-[10px] text-fg-3 tnum">{relativeTime(c.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Related messages */}
          {relatedMessages.length > 0 ? (
            <section className="mt-8">
              <h4 className="eyebrow mb-2">Thread · {relatedMessages.length} messages</h4>
              <div className="space-y-2">
                {relatedMessages.slice(-10).map((m: Message) => (
                  <MessageBubble key={m.id} message={m} />
                ))}
              </div>
            </section>
          ) : null}

          {error ? (
            <div className="mt-5 rounded-lg border border-err/40 bg-err-soft px-3 py-2 text-[12px] text-err">
              {error}
            </div>
          ) : null}
        </div>

        {/* Footer actions */}
        <footer className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-hairline bg-canvas-raised/80 px-8 py-4 backdrop-blur-xl">
          <button type="button" className="btn-danger btn-sm" onClick={handleDelete} disabled={deleting}>
            Delete
          </button>
          <div className="flex items-center gap-3">
            {dirty ? <span className="pill pill-warn">unsaved</span> : null}
            <button type="button" className="btn-ghost" onClick={onClose}>
              {dirty ? 'Cancel' : 'Close'}
            </button>
            <button type="button" className="btn" onClick={save} disabled={!dirty || saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="eyebrow">{label}</span>
      {children}
    </label>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="eyebrow">{label}</span>
      <span className="text-[12px] text-fg">{value}</span>
    </div>
  );
}

function AssigneeBadge({ agent }: { agent: Agent }) {
  const tint = ROLE_TINT[agent.role];
  return (
    <Link
      to={`/agents/${agent.id}`}
      className="flex items-center gap-3 rounded-xl border border-hairline bg-sheen/[0.02] px-3 py-2 hover:border-hairline-strong"
    >
      <AgentAvatar agent={agent} size="md" showStatus />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-fg">{agent.name}</div>
        <div className={['text-[11px]', tint ?? 'text-fg-2'].join(' ')}>{agent.role}</div>
      </div>
      <span className="text-[10px] text-fg-3">open →</span>
    </Link>
  );
}
