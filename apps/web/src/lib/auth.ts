import { create } from 'zustand';
import * as api from './api';

export type AuthPhase = 'loading' | 'needs-setup' | 'logged-out' | 'logged-in';

interface AuthState {
  phase: AuthPhase;
  user: api.AuthUser | null;
  /**
   * Set right after the install wizard creates the first admin. Tells
   * AuthGate to keep rendering the wizard's "post-setup" steps (GitHub
   * connect, etc.) before handing control to the main app routes.
   * Cleared by `dismissPostSetup()`.
   */
  postSetupPending: boolean;
  /** Bootstrap: ask the server who we are. Runs on first mount. */
  bootstrap: () => Promise<void>;
  setupAdmin: (input: { email: string; username: string; password: string }) => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (u: api.AuthUser | null) => void;
  dismissPostSetup: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  phase: 'loading',
  user: null,
  postSetupPending: false,

  setUser: (u) => set({ user: u, phase: u ? 'logged-in' : 'logged-out' }),
  dismissPostSetup: () => set({ postSetupPending: false }),

  async bootstrap() {
    try {
      const status = await api.setupStatus();
      if (status.needsSetup) {
        set({ phase: 'needs-setup', user: null });
        return;
      }
    } catch {
      // Backend down — keep loading state; the user will see the spinner.
      // We don't flip to needs-setup on a network error, that would be misleading.
      set({ phase: 'loading', user: null });
      return;
    }
    try {
      const user = await api.me();
      set({ user, phase: 'logged-in' });
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) {
        set({ user: null, phase: 'logged-out' });
      } else {
        set({ user: null, phase: 'logged-out' });
      }
    }
  },

  async setupAdmin(input) {
    const user = await api.setupAdmin(input);
    set({ user, phase: 'logged-in', postSetupPending: true });
  },

  async login(identifier, password) {
    const user = await api.login({ identifier, password });
    set({ user, phase: 'logged-in' });
  },

  async logout() {
    try {
      await api.logout();
    } catch {
      /* still clear locally */
    }
    set({ user: null, phase: 'logged-out' });
  },
}));
