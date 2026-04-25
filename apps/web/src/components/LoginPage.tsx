import { useState } from 'react';
import { useAuth } from '@/lib/auth';

export function LoginPage() {
  const login = useAuth((s) => s.login);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !identifier.trim() || !password) return;
    setBusy(true);
    setErr(null);
    try {
      await login(identifier.trim(), password);
    } catch (e) {
      setErr(humanizeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-6 text-fg">
      <div className="w-full max-w-sm">
        <header className="mb-8 text-center">
          <img src="/brand/logo.png" alt="AgentBoard" className="mx-auto h-12 w-12 select-none" />
          <h1 className="display mt-3 text-[22px] font-semibold tracking-tight text-fg">
            Sign in to AgentBoard
          </h1>
        </header>

        <form
          onSubmit={submit}
          className="rounded-2xl border border-hairline bg-sheen/[0.02] p-6 backdrop-blur-xl"
        >
          <label className="mb-3 block">
            <span className="eyebrow mb-1 block">Email or username</span>
            <input
              type="text"
              autoComplete="username"
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="input w-full"
              autoFocus
            />
          </label>
          <label className="mb-3 block">
            <span className="eyebrow mb-1 block">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input w-full"
            />
          </label>

          {err ? (
            <div className="mb-3 rounded-lg border border-err/40 bg-err-soft px-3 py-2 text-[12px] text-err">
              {err}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={busy || !identifier.trim() || !password}
            className="btn w-full"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

function humanizeError(e: unknown): string {
  const status = (e as { status?: number }).status;
  const body = (e as { body?: { error?: string; retryAfter?: number } }).body;
  if (status === 401) return 'Wrong email/username or password.';
  if (status === 429) {
    const sec = body?.retryAfter ?? 60;
    return `Too many attempts. Try again in ${sec}s.`;
  }
  return e instanceof Error ? e.message : 'Sign in failed.';
}
