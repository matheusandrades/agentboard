export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'agentboard.theme';

/**
 * Read user's theme preference: explicit localStorage → system preference →
 * dark fallback.
 */
export function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* private mode */
  }
  if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

/** Apply theme class to <html>. Called before React renders to avoid FOUC. */
export function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', mode === 'dark');
  root.dataset.theme = mode;
}

export function setTheme(mode: ThemeMode): void {
  applyTheme(mode);
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function toggleTheme(): ThemeMode {
  const current = (document.documentElement.dataset.theme as ThemeMode) ?? getInitialTheme();
  const next: ThemeMode = current === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}
