import { useState } from 'react';
import { useAuth } from '@/lib/auth';

/**
 * First-run install wizard. Shown when /api/setup/status returns
 * needsSetup=true. Creates the initial admin and logs them in.
 */
export function SetupWizard() {
  const setupAdmin = useAuth((s) => s.setupAdmin);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ok =
    email.trim().length > 3 &&
    /@/.test(email) &&
    username.trim().length >= 2 &&
    password.length >= 8 &&
    password === confirm;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await setupAdmin({ email: email.trim(), username: username.trim(), password });
    } catch (e) {
      setErr(humanizeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-6 text-fg">
      <div className="w-full max-w-md">
        <header className="mb-8 text-center">
          <img src="/brand/logo.png" alt="AgentBoard" className="mx-auto h-14 w-14 select-none" />
          <h1 className="display mt-3 text-[26px] font-semibold tracking-tight text-fg">
            Welcome to AgentBoard
          </h1>
          <p className="mt-2 text-[13px] text-fg-2">
            Create the first administrator account. They can invite teammates from the{' '}
            <span className="text-fg">Users</span> page later.
          </p>
        </header>

        <form
          onSubmit={submit}
          className="rounded-2xl border border-hairline bg-sheen/[0.02] p-6 backdrop-blur-xl"
        >
          <Field label="Email">
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input w-full"
              placeholder="you@yourcompany.com"
            />
          </Field>
          <Field label="Username">
            <input
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input w-full"
              placeholder="admin"
            />
            <p className="mt-1 text-[11px] text-fg-3">
              Letters, digits, dot/underscore/dash. 2–50 chars.
            </p>
          </Field>
          <Field label="Password">
            <input
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input w-full"
              placeholder="At least 8 characters"
            />
          </Field>
          <Field label="Confirm password">
            <input
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="input w-full"
            />
            {confirm && confirm !== password ? (
              <p className="mt-1 text-[11px] text-err">Passwords don't match.</p>
            ) : null}
          </Field>

          {err ? (
            <div className="mb-3 rounded-lg border border-err/40 bg-err-soft px-3 py-2 text-[12px] text-err">
              {err}
            </div>
          ) : null}

          <button type="submit" disabled={!ok || busy} className="btn w-full">
            {busy ? 'Creating administrator…' : 'Create administrator + sign in'}
          </button>

          <p className="mt-4 text-center text-[11px] text-fg-3">
            This account stays on your machine — AgentBoard never phones home with it. Change it
            anytime from Settings.
          </p>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="eyebrow mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function humanizeError(e: unknown): string {
  const status = (e as { status?: number }).status;
  if (status === 409) return 'Already initialised — refresh and sign in.';
  if (status === 400) return 'Some fields look invalid. Double-check and try again.';
  return e instanceof Error ? e.message : 'Setup failed. See server logs.';
}
