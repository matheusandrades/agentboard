import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/lib/auth';
import * as api from '@/lib/api';
import { relativeTime } from '@/lib/time';

type Role = 'admin' | 'member';

export function Users() {
  const me = useAuth((s) => s.user);
  const [list, setList] = useState<api.AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  async function refresh() {
    try {
      setError(null);
      setList(await api.listUsers());
    } catch (e) {
      setError(humanize(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const adminCount = useMemo(
    () => list.filter((u) => u.role === 'admin' && !u.isDisabled).length,
    [list],
  );
  const isAdmin = me?.role === 'admin';

  if (!isAdmin) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader eyebrow="Users" title="Operators" />
        <div className="px-8 py-6 text-[13px] text-fg-2">
          Only administrators can manage users. Ask one of them to invite you.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        eyebrow="Users"
        title="Operators"
        subtitle={
          <span>
            <span className="text-fg tnum">{list.length}</span> total ·{' '}
            <span className="text-fg tnum">{adminCount}</span> admins
          </span>
        }
        actions={
          <button type="button" className="btn btn-sm" onClick={() => setShowCreate(true)}>
            + Invite user
          </button>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        {error ? (
          <div className="mb-3 rounded-lg border border-err/40 bg-err-soft px-3 py-2 text-[12px] text-err">
            {error}
          </div>
        ) : null}
        {loading ? (
          <p className="text-[13px] text-fg-3">Loading…</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-hairline">
            <table className="w-full text-[13px]">
              <thead className="bg-canvas-sunken/40 text-[10px] uppercase tracking-wider text-fg-3">
                <tr>
                  <th className="px-4 py-2 text-left">User</th>
                  <th className="px-4 py-2 text-left">Email</th>
                  <th className="px-4 py-2 text-left">Role</th>
                  <th className="px-4 py-2 text-left">Last login</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {list.map((u) => (
                  <UserRow
                    key={u.id}
                    user={u}
                    isMe={u.id === me?.id}
                    canDemoteOrDisable={
                      // We can never leave zero active admins.
                      !(u.role === 'admin' && adminCount <= 1)
                    }
                    onChanged={refresh}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 text-[11px] text-fg-3">
          Disabling a user revokes all their sessions immediately. Deleting cascades to their
          sessions and removes them from any audit lookups going forward (existing rows keep their
          UUID as a reference).
        </p>
      </div>

      {showCreate ? (
        <CreateUserDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function UserRow({
  user,
  isMe,
  canDemoteOrDisable,
  onChanged,
}: {
  user: api.AuthUser;
  isMe: boolean;
  canDemoteOrDisable: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function setRole(role: Role) {
    if (busy) return;
    setBusy(true);
    try {
      await api.updateUser(user.id, { role });
      onChanged();
    } catch (e) {
      alert(humanize(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleDisabled() {
    if (busy) return;
    setBusy(true);
    try {
      await api.updateUser(user.id, { isDisabled: !user.isDisabled });
      onChanged();
    } catch (e) {
      alert(humanize(e));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    const next = prompt('New password (8+ chars). The user will be signed out everywhere:');
    if (!next || next.length < 8) return;
    setBusy(true);
    try {
      await api.resetUserPassword(user.id, next);
      alert('Password updated. Tell them out-of-band.');
    } catch (e) {
      alert(humanize(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete "${user.username}"? This is permanent.`)) return;
    setBusy(true);
    try {
      await api.deleteUser(user.id);
      onChanged();
    } catch (e) {
      alert(humanize(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className={user.isDisabled ? 'opacity-60' : ''}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-fg">{user.username}</span>
          {isMe ? <span className="pill text-[10px]">you</span> : null}
          {user.isDisabled ? <span className="pill pill-warn text-[10px]">disabled</span> : null}
        </div>
      </td>
      <td className="px-4 py-3 font-mono text-[11.5px] text-fg-2">{user.email}</td>
      <td className="px-4 py-3">
        <select
          className="input py-0.5 text-[12px]"
          value={user.role}
          disabled={busy || (user.role === 'admin' && !canDemoteOrDisable)}
          onChange={(e) => setRole(e.target.value as Role)}
        >
          <option value="member">member</option>
          <option value="admin">admin</option>
        </select>
      </td>
      <td className="px-4 py-3 font-mono text-[11px] text-fg-3">
        {user.lastLoginAt ? relativeTime(user.lastLoginAt) : '—'}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="inline-flex gap-1">
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={reset}
            disabled={busy}
            title="Reset password"
          >
            Reset password
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={toggleDisabled}
            disabled={busy || isMe || (!canDemoteOrDisable && !user.isDisabled)}
            title={isMe ? "Can't disable yourself" : ''}
          >
            {user.isDisabled ? 'Enable' : 'Disable'}
          </button>
          <button
            type="button"
            className="btn-danger btn-sm"
            onClick={remove}
            disabled={busy || isMe || (!canDemoteOrDisable && user.role === 'admin')}
            title={isMe ? "Can't delete yourself" : ''}
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}

function CreateUserDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ok =
    email.trim().length > 3 &&
    /@/.test(email) &&
    username.trim().length >= 2 &&
    password.length >= 8;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api.createUser({
        email: email.trim(),
        username: username.trim(),
        password,
        role,
      });
      onCreated();
    } catch (e) {
      setErr(humanize(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-hairline bg-canvas-raised p-6"
      >
        <h2 className="text-[16px] font-medium text-fg">Invite user</h2>
        <p className="mt-1 text-[12px] text-fg-2">
          Send the credentials to your teammate out-of-band. They can change their password from
          their account menu after first sign-in.
        </p>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="eyebrow mb-1 block">Email</span>
            <input
              type="email"
              className="input w-full"
              value={email}
              required
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="eyebrow mb-1 block">Username</span>
            <input
              type="text"
              className="input w-full"
              value={username}
              required
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="eyebrow mb-1 block">Initial password</span>
            <input
              type="text"
              className="input w-full"
              value={password}
              required
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-fg-3">8+ chars. Tell them to change it.</p>
          </label>
          <label className="block">
            <span className="eyebrow mb-1 block">Role</span>
            <select
              className="input w-full"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              <option value="member">member — can run the team</option>
              <option value="admin">admin — full control + user management</option>
            </select>
          </label>
        </div>
        {err ? (
          <div className="mt-3 rounded-lg border border-err/40 bg-err-soft px-3 py-2 text-[12px] text-err">
            {err}
          </div>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-sm" disabled={!ok || busy}>
            {busy ? 'Creating…' : 'Create user'}
          </button>
        </div>
      </form>
    </div>
  );
}

function humanize(e: unknown): string {
  const status = (e as { status?: number }).status;
  const body = (e as { body?: { error?: string } }).body;
  if (status === 409 && body?.error === 'last_admin') {
    return 'Cannot demote/disable/delete the last admin.';
  }
  if (status === 409 && body?.error === 'already_exists') {
    return 'A user with that email or username already exists.';
  }
  if (status === 409 && body?.error === 'cannot_delete_self') {
    return "You can't delete your own account.";
  }
  if (status === 403) return 'Forbidden — admin role required.';
  return e instanceof Error ? e.message : 'Request failed';
}
