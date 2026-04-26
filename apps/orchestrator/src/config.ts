import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the monorepo root so WORKSPACE_ROOT and persona paths resolve
// independently of the process CWD (PM2 runs us from apps/orchestrator).
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// src/config.ts → apps/orchestrator/src → apps/orchestrator → apps → <repo-root>
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

// Load .env from the monorepo root (where it actually lives) first, then
// allow an optional local apps/orchestrator/.env override.
dotenvConfig({ path: path.join(REPO_ROOT, '.env') });
dotenvConfig();

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),

  ANTHROPIC_API_KEY: z.string().optional(),

  DATABASE_URL: z
    .string()
    .default('postgresql://agentboard:agentboard@localhost:55432/agentboard'),

  REDIS_URL: z.string().default('redis://localhost:56379'),

  ORCHESTRATOR_PORT: z.coerce.number().int().positive().default(3001),
  ORCHESTRATOR_HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  AGENT_MAX_TURNS: z.coerce.number().int().positive().default(25),
  AGENT_TURN_TIMEOUT_MS: z.coerce.number().int().positive().default(900_000),

  WORKSPACE_ROOT: z.string().default(path.join(REPO_ROOT, 'workspace')),

  VITE_WEB_URL: z.string().default('http://localhost:5173'),

  // GitHub OAuth App — register one at https://github.com/settings/applications/new
  // The redirect URL in the app config must match GITHUB_OAUTH_REDIRECT_URL.
  GITHUB_OAUTH_CLIENT_ID: z.string().optional(),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().optional(),
  GITHUB_OAUTH_REDIRECT_URL: z
    .string()
    .default('http://localhost:3001/api/github/oauth/callback'),

  // Public-facing base URL of the orchestrator. Used for GitHub App
  // manifest callbacks, installation callbacks, and webhook URLs. If
  // unset we derive it by stripping the OAuth callback suffix above.
  PUBLIC_BASE_URL: z.string().optional(),

  // GitHub App (optional, for finer-grained per-repo install). When unset
  // we expose the OAuth flow + PAT only.
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_CLIENT_ID: z.string().optional(),
  GITHUB_APP_CLIENT_SECRET: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_NAME: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),

  TEST_REDIS_URL: z.string().optional(),
});

function parseEnv() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Flatten to make things readable in logs.
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}

export const env = parseEnv();

export const paths = {
  repoRoot: REPO_ROOT,
  personasDir: path.join(REPO_ROOT, 'agents'),
  rulesDir: path.join(REPO_ROOT, 'rules'),
  workspaceRoot: path.isAbsolute(env.WORKSPACE_ROOT)
    ? env.WORKSPACE_ROOT
    : path.resolve(REPO_ROOT, env.WORKSPACE_ROOT),
};
