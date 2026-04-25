import { useMemo, useState, type FormEvent } from 'react';
import { useBoardStore } from '@/lib/store';
import { MessageBubble } from '@/components/MessageBubble';
import * as api from '@/lib/api';
import type { MessageType } from '@/lib/types';

type ChatMessageType = Extract<MessageType, 'assignment' | 'question' | 'broadcast'>;

const TYPES: { value: ChatMessageType; label: string }[] = [
  { value: 'assignment', label: 'Assignment' },
  { value: 'question', label: 'Question' },
  { value: 'broadcast', label: 'Broadcast' },
];

export function Chat() {
  const agents = useBoardStore((s) => s.agents);
  const messages = useBoardStore((s) => s.messages);
  const appendMessage = useBoardStore((s) => s.appendMessage);

  const [to, setTo] = useState<string>('');
  const [type, setType] = useState<ChatMessageType>('question');
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stakeholderMessages = useMemo(
    () =>
      messages
        .filter((m) => m.from === 'stakeholder' || m.to === 'stakeholder')
        .slice()
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [messages],
  );

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
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
      const created = await api.sendMessage({
        from: 'stakeholder',
        to: target || '*',
        type,
        subject: subject.trim(),
        content: content.trim(),
      });
      appendMessage(created);
      setSubject('');
      setContent('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="relative bloom px-8 pt-10 pb-4">
        <span className="eyebrow">Chat</span>
        <h2 className="display mt-3 text-display-xl text-fg">Talk to your team</h2>
        <p className="mt-3 max-w-xl text-[12px] text-fg-2">
          Assign work, ask questions, or broadcast to the whole bureau.
        </p>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[440px_1fr]">
        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-4 border-r border-hairline p-8"
        >
          <div>
            <span className="eyebrow mb-2 block">Message type</span>
            <div className="flex gap-2">
              {TYPES.map((t) => (
                <button
                  type="button"
                  key={t.value}
                  onClick={() => setType(t.value)}
                  className={[
                    'rounded-full border px-3 py-1 text-[12px] transition',
                    type === t.value
                      ? 'border-violet/50 bg-violet-soft text-fg shadow-glow-sm'
                      : 'border-hairline bg-sheen/[0.02] text-fg-2 hover:border-hairline-strong hover:text-fg',
                  ].join(' ')}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {type !== 'broadcast' ? (
            <label className="flex flex-col gap-1.5">
              <span className="eyebrow">To</span>
              <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">Pick an agent…</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.name}>
                    {a.name} · {a.role}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-[12px] text-fg-3">Will reach everyone on the team.</p>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="eyebrow">Subject</span>
            <input
              className="input"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Short summary"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="eyebrow">Message</span>
            <textarea
              className="textarea min-h-[180px]"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="What do you want them to do?"
            />
          </label>

          {error ? (
            <div className="rounded-lg border border-err/40 bg-err-soft px-3 py-2 text-[12px] text-err">
              {error}
            </div>
          ) : null}

          <button type="submit" className="btn" disabled={sending}>
            {sending ? 'Sending…' : 'Send dispatch'}
          </button>
        </form>

        <div className="flex min-h-0 flex-col">
          <header className="border-b border-hairline px-8 py-3">
            <span className="eyebrow">Stakeholder thread · {stakeholderMessages.length}</span>
          </header>
          <div className="flex-1 space-y-3 overflow-auto px-8 py-5">
            {stakeholderMessages.length === 0 ? (
              <p className="text-[13px] text-fg-3">No messages yet — say hi to the team.</p>
            ) : (
              stakeholderMessages.map((m) => <MessageBubble key={m.id} message={m} />)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
