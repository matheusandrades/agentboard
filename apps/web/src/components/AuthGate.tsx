import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { SetupWizard } from './SetupWizard';
import { PostSetupWizard } from './PostSetupWizard';
import { LoginPage } from './LoginPage';

/**
 * Wraps the app and decides what to show:
 *  - while the auth state is bootstrapping → a quiet splash
 *  - if no admin exists yet → SetupWizard
 *  - if not logged in → LoginPage
 *  - otherwise → render children (the normal app)
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const phase = useAuth((s) => s.phase);
  const postSetupPending = useAuth((s) => s.postSetupPending);
  const bootstrap = useAuth((s) => s.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (phase === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas text-fg-3">
        <div className="flex items-center gap-3">
          <span className="h-2 w-2 animate-breath rounded-full bg-accent" />
          <span className="text-[12px]">Connecting to AgentBoard…</span>
        </div>
      </div>
    );
  }

  if (phase === 'needs-setup') return <SetupWizard />;
  if (phase === 'logged-out') return <LoginPage />;
  if (postSetupPending) return <PostSetupWizard />;
  return <>{children}</>;
}
