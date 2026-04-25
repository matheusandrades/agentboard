import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AGENT_ROLES, type AgentRole } from '@agentboard/shared';
import * as api from '@/lib/api';
import { useBoardStore } from '@/lib/store';

interface Props {
  onClose: () => void;
}

const ROLE_ENTRIES = Object.entries(AGENT_ROLES) as [
  AgentRole,
  { defaultName: string; title: string },
][];

export function AgentNewDialog({ onClose }: Props) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<AgentRole>('frontend');
  const [persona, setPersona] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const setAgents = useBoardStore((s) => s.setAgents);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tpl = await api.getPersonaTemplate(role);
        if (!cancelled) setPersona(tpl);
      } catch {
        if (!cancelled) setPersona('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const created = await api.createAgent({
        name: name || AGENT_ROLES[role].defaultName,
        role,
        persona,
      });
      const agents = await api.listAgents();
      setAgents(agents);
      onClose();
      navigate(`/agents/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent');
      setSubmitting(false);
    }
  }

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
        <header className="sticky top-0 z-10 shrink-0 border-b border-hairline bg-canvas-raised/80 px-8 pb-5 pt-8 backdrop-blur-xl">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-5 top-5 btn-icon"
            aria-label="Close"
          >
            ✕
          </button>
          <span className="eyebrow">Onboarding</span>
          <h2 className="display mt-3 text-3xl text-fg">Hire a new agent</h2>
          <p className="mt-2 max-w-lg text-[13px] text-fg-2">
            Give them a handle, choose a beat, and tune the persona. You can revise anything
            later from the agent's page.
          </p>
        </header>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="eyebrow">Handle</span>
              <input
                className="input"
                placeholder={AGENT_ROLES[role].defaultName}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="eyebrow">Role</span>
              <select
                className="input"
                value={role}
                onChange={(e) => setRole(e.target.value as AgentRole)}
              >
                {ROLE_ENTRIES.map(([key, meta]) => (
                  <option key={key} value={key}>
                    {meta.title}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="mt-6 flex flex-1 flex-col gap-1.5">
            <span className="eyebrow flex items-center justify-between">
              <span>Persona · system prompt</span>
              <span className="text-fg-3 normal-case tracking-normal">
                pre-filled from {AGENT_ROLES[role].title} template
              </span>
            </span>
            <textarea
              className="textarea min-h-[360px] flex-1"
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
            />
          </label>

          {error ? (
            <div className="mt-4 rounded-lg border border-err/40 bg-err-soft px-3 py-2 text-[12px] text-err">
              {error}
            </div>
          ) : null}

          <footer className="mt-6 flex items-center justify-end gap-3 border-t border-hairline pt-5">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn" disabled={submitting}>
              {submitting ? 'Hiring…' : 'Hire agent'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
