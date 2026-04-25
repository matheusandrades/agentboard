import { useState, type FormEvent } from 'react';
import { useBoardStore } from '@/lib/store';
import * as api from '@/lib/api';
import { relativeTime } from '@/lib/time';

export function Sprints() {
  const sprints = useBoardStore((s) => s.sprints);
  const setSprints = useBoardStore((s) => s.setSprints);

  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setBusy(true);
    try {
      const created = await api.createSprint({
        name: name.trim(),
        goal: goal.trim() || null,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      });
      setSprints([...sprints, created]);
      setName('');
      setGoal('');
      setEndsAt('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create sprint');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="relative bloom px-8 pt-10 pb-4">
        <span className="eyebrow">Sprints</span>
        <h2 className="display mt-3 text-display-xl text-fg">Plan & ship</h2>
        <p className="mt-3 max-w-xl text-[12px] text-fg-2">
          <span className="text-fg">{sprints.length}</span>{' '}
          {sprints.length === 1 ? 'sprint' : 'sprints'} in flight.
        </p>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-auto px-8 py-6 lg:grid-cols-[420px_1fr]">
        <form onSubmit={onSubmit} className="glass h-fit p-6">
          <h3 className="text-[15px] font-medium tracking-tight text-fg">New sprint</h3>
          <div className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="eyebrow">Name</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sprint 2" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="eyebrow">Goal</span>
              <textarea
                rows={3}
                className="textarea"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="What are we aiming for?"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="eyebrow">End date</span>
              <input type="date" className="input" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </label>
            {error ? (
              <div className="rounded-lg border border-err/40 bg-err-soft px-3 py-2 text-[12px] text-err">{error}</div>
            ) : null}
            <button type="submit" className="btn" disabled={busy}>
              {busy ? 'Creating…' : 'Create sprint'}
            </button>
          </div>
        </form>

        <div className="flex flex-col gap-3">
          {sprints.length === 0 ? (
            <div className="glass flex items-center justify-center p-10 text-[13px] text-fg-3">
              No sprints yet. Create one to start planning.
            </div>
          ) : (
            sprints.map((s) => (
              <article key={s.id} className="glass p-5">
                <header className="flex items-center justify-between">
                  <h3 className="text-[16px] font-medium tracking-tight text-fg">{s.name}</h3>
                  <span
                    className={
                      s.status === 'active'
                        ? 'pill pill-ok'
                        : s.status === 'planning'
                          ? 'pill pill-warn'
                          : 'pill'
                    }
                  >
                    {s.status}
                  </span>
                </header>
                {s.goal ? <p className="mt-2 text-[13px] text-fg-2">{s.goal}</p> : null}
                <footer className="mt-3 flex gap-4 text-[11px] text-fg-3 font-mono">
                  {s.startedAt ? <span>started {relativeTime(s.startedAt)}</span> : null}
                  {s.endsAt ? <span>ends {relativeTime(s.endsAt)}</span> : null}
                </footer>
              </article>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
