import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useBoardStore } from '@/lib/store';
import * as api from '@/lib/api';
import { MessageBubble } from './MessageBubble';
import type { MessageType, Project } from '@/lib/types';

type ChatMessageType = Extract<MessageType, 'assignment' | 'question' | 'broadcast'>;

const TYPES: { value: ChatMessageType; label: string }[] = [
  { value: 'assignment', label: 'Assignment' },
  { value: 'question', label: 'Question' },
  { value: 'broadcast', label: 'Broadcast' },
];

/**
 * Floating chat launcher — pinned to the bottom-right of the viewport on
 * every page. Click the FAB to pop a centered modal with the composer and
 * the 5 most recent stakeholder ↔ agent messages. Keyboard: Cmd/Ctrl+K to
 * open, Escape to close.
 */
export function ChatLauncher() {
  const [open, setOpen] = useState(false);
  const agents = useBoardStore((s) => s.agents);
  const messages = useBoardStore((s) => s.messages);
  const appendMessage = useBoardStore((s) => s.appendMessage);

  const stakeholderMessages = useMemo(
    () =>
      messages
        .filter((m) => m.from === 'stakeholder' || m.to === 'stakeholder')
        .slice()
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [messages],
  );

  // Count pending replies waiting for the stakeholder to read. Here that's a
  // proxy — "messages I haven't seen" — since there's no per-user read state
  // yet, we just show the total number of inbound msgs to stakeholder.
  const inbound = stakeholderMessages.filter((m) => m.to === 'stakeholder').length;

  // Cmd/Ctrl+J open chat. ⌘K is the global command palette now.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open]);

  return (
    <>
      <FAB inbound={inbound} onClick={() => setOpen(true)} open={open} />
      {open ? (
        <ChatModal
          onClose={() => setOpen(false)}
          agents={agents}
          stakeholderMessages={stakeholderMessages}
          onSent={appendMessage}
        />
      ) : null}
    </>
  );
}

/* ──────────────────────── FAB ──────────────────────────── */
function FAB({
  inbound,
  onClick,
  open,
}: {
  inbound: number;
  onClick: () => void;
  open: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open chat"
      aria-expanded={open}
      className={[
        'fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full',
        'bg-accent text-white shadow-[0_12px_40px_-12px_rgb(255_110_0/0.6),0_0_0_1px_rgb(var(--accent)/0.4)] transition',
        'hover:-translate-y-0.5 hover:shadow-[0_18px_50px_-12px_rgb(255_110_0/0.7)]',
        'active:translate-y-0 active:scale-95',
        open ? 'opacity-0 pointer-events-none' : 'opacity-100',
      ].join(' ')}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M4 5.5h16v11.5H9.5L5.5 20V5.5z" />
      </svg>
      {inbound > 0 ? (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-canvas px-1 text-[10px] font-semibold text-accent ring-2 ring-accent tnum">
          {inbound}
        </span>
      ) : null}
      <span className="sr-only">Chat with the team (⌘J)</span>
    </button>
  );
}

/* ────────────────────── Modal ──────────────────────────── */
interface ModalProps {
  onClose: () => void;
  agents: ReturnType<typeof useBoardStore.getState>['agents'];
  stakeholderMessages: ReturnType<typeof useBoardStore.getState>['messages'];
  onSent: (m: import('@/lib/types').AgentMessage) => void;
}

function ChatModal({ onClose, agents, stakeholderMessages, onSent }: ModalProps) {
  const [to, setTo] = useState<string>(agents[0]?.name ?? '');
  const [type, setType] = useState<ChatMessageType>('assignment');
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [projectId, setProjectId] = useState<string>('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .listProjects()
      .then((ps) => {
        setProjects(ps);
        if (ps.length === 1) setProjectId(ps[0]!.id);
      })
      .catch(() => undefined);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!subject.trim() || !content.trim()) {
      setError('Subject and content are required.');
      return;
    }
    const target = type === 'broadcast' ? '*' : to;
    if (type !== 'broadcast' && !target) {
      setError('Pick a target agent.');
      return;
    }
    setSending(true);
    try {
      // If the stakeholder picked a project, spin up a stakeholder task bound
      // to it up-front so the agents inherit the project/branch for the
      // whole thread. Otherwise we just send the raw message as before.
      let taskId: string | undefined;
      if (projectId && type !== 'broadcast') {
        const task = await api.createTask({
          title: subject.trim(),
          description: content.trim(),
          projectId,
        });
        taskId = task.id;
      }
      const created = await api.sendMessage({
        from: 'stakeholder',
        to: target || '*',
        type,
        subject: subject.trim(),
        content:
          taskId
            ? `${content.trim()}\n\n_Project-bound: work on task ${taskId}; commits must go there._`
            : content.trim(),
        taskId,
      });
      onSent(created);
      setSubject('');
      setContent('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  // Cmd/Ctrl+Enter submit
  function onContentKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-float-in"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex max-h-[82vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-hairline bg-canvas-raised shadow-glass-lg"
        role="dialog"
        aria-modal="true"
        aria-label="Chat with the team"
      >
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between border-b border-hairline px-6 py-4">
          <div>
            <span className="eyebrow">Chat</span>
            <h2 className="mt-0.5 text-[18px] font-semibold tracking-tight text-fg">
              Talk to your team
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/chat"
              onClick={onClose}
              className="btn-ghost btn-sm"
              title="Open full thread view"
            >
              Full view ↗
            </Link>
            <button type="button" onClick={onClose} className="btn-icon" aria-label="Close">
              ✕
            </button>
          </div>
        </header>

        {/* Body: composer on top, recent thread below */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <form onSubmit={onSubmit} className="grid gap-3 border-b border-hairline px-6 py-5">
            {/* Type pills */}
            <div className="flex items-center gap-1.5">
              {TYPES.map((t) => (
                <button
                  type="button"
                  key={t.value}
                  onClick={() => setType(t.value)}
                  className={[
                    'rounded-full border px-2.5 py-1 text-[11px] transition duration-150',
                    type === t.value
                      ? 'border-accent/50 bg-violet-soft text-fg shadow-glow-sm'
                      : 'border-hairline bg-sheen/[0.02] text-fg-2 hover:border-hairline-strong hover:text-fg',
                  ].join(' ')}
                >
                  {t.label}
                </button>
              ))}
              {type !== 'broadcast' ? (
                <select
                  className="input ml-2 !w-auto min-w-[180px] py-1 text-[12px]"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                >
                  <option value="">Pick agent…</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.name}>
                      {a.name} · {a.role}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="ml-2 text-[11px] text-fg-3">→ everyone</span>
              )}
            </div>

            <input
              className="input"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              autoFocus
            />

            {projects.length > 0 && type !== 'broadcast' ? (
              <div className="flex items-center gap-2">
                <span className="eyebrow whitespace-nowrap">Project</span>
                <select
                  className="input py-1 text-[12px]"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                >
                  <option value="">— none (throwaway worktree) —</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.repoOwner}/{p.repoName}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <textarea
              className="textarea min-h-[140px]"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={onContentKeyDown}
              placeholder="What do you want them to do? (⌘/Ctrl+Enter to send)"
            />

            {error ? (
              <div className="rounded-lg border border-err/40 bg-err-soft px-3 py-2 text-[12px] text-err">
                {error}
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <span className="mr-auto text-[10px] text-fg-3">⌘K to toggle</span>
              <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-sm" disabled={sending}>
                {sending ? 'Sending…' : 'Send dispatch'}
              </button>
            </div>
          </form>

          {/* Recent thread */}
          <section className="bg-sheen/[0.015] px-6 py-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="eyebrow">
                Recent thread · {stakeholderMessages.length}
              </span>
              <Link to="/chat" onClick={onClose} className="text-[11px] text-accent hover:underline">
                See all →
              </Link>
            </div>
            {stakeholderMessages.length === 0 ? (
              <p className="py-6 text-center text-[12px] text-fg-3">
                No messages yet — say hi to the team.
              </p>
            ) : (
              <div className="space-y-2">
                {stakeholderMessages.slice(0, 5).map((m) => (
                  <MessageBubble key={m.id} message={m} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
