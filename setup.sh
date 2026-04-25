#!/usr/bin/env bash
# AgentBoard one-shot installer.
# Brings up Postgres + Redis in Docker, installs deps, applies migrations,
# seeds the default 8 agents, and starts orchestrator + web under PM2.
#
#   curl -fsSL https://raw.githubusercontent.com/<org>/agentboard/main/setup.sh | bash
#
# (Local equivalent: ./setup.sh)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

say()  { printf '\n\033[1;33m▶ %s\033[0m\n' "$*"; }
info() { printf '  \033[2m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*"; exit 1; }

# ── 1. Prereqs ───────────────────────────────────────────────────
say "Checking prerequisites"
command -v node    >/dev/null || fail "Node 20+ is required. https://nodejs.org"
command -v docker  >/dev/null || fail "Docker is required. https://docs.docker.com/get-docker/"
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 plugin is required."

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || fail "Node 20+ required (you have $(node -v))."

# pnpm via corepack — no global install.
corepack enable >/dev/null 2>&1 || true
PNPM=(corepack pnpm)

info "Node $(node -v) ✓"
info "Docker $(docker --version | awk '{print $3}' | tr -d ',') ✓"

# ── 2. .env ──────────────────────────────────────────────────────
if [ ! -f .env ]; then
  say "Creating .env from .env.example"
  cp .env.example .env
  info "Edit .env to add ANTHROPIC_API_KEY (optional — gh CLI auth also works)."
fi

# ── 3. Dependencies ──────────────────────────────────────────────
say "Installing dependencies (pnpm install)"
"${PNPM[@]}" install --silent

# ── 4. Bring up Postgres + Redis ─────────────────────────────────
say "Starting Postgres + Redis (Docker)"
"${PNPM[@]}" infra:up >/dev/null
info "Waiting for Postgres to be healthy…"
ATTEMPTS=0
until docker exec agentboard-postgres pg_isready -U agentboard -d agentboard >/dev/null 2>&1; do
  ATTEMPTS=$((ATTEMPTS + 1))
  [ "$ATTEMPTS" -gt 30 ] && fail "Postgres didn't become healthy in 60s."
  sleep 2
done
info "Postgres ✓ Redis ✓"

# ── 5. Migrations + seed ─────────────────────────────────────────
say "Running database migrations + seeding agents"
"${PNPM[@]}" db:migrate >/dev/null
"${PNPM[@]}" db:seed   >/dev/null
info "Schema applied, 8 agents + 1 sprint seeded."

# ── 6. Start with PM2 ────────────────────────────────────────────
say "Booting orchestrator + web (PM2)"
"${PNPM[@]}" start >/dev/null

# ── 7. Health check ──────────────────────────────────────────────
say "Waiting for services to be ready"
for url in http://localhost:3001/api/health http://localhost:5173/; do
  ATTEMPTS=0
  until curl -fsS "$url" >/dev/null 2>&1; do
    ATTEMPTS=$((ATTEMPTS + 1))
    [ "$ATTEMPTS" -gt 30 ] && fail "$url didn't respond in 60s."
    sleep 2
  done
  info "$url ✓"
done

# ── 8. Optional: detect gh CLI for friendlier first-run ──────────
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  GH_USER=$(gh api user --jq .login 2>/dev/null || echo unknown)
  info "GitHub CLI detected — connected as $GH_USER (auto-pickup in /settings)."
else
  info "Tip: install + 'gh auth login' to enable repo cloning + PR opens, OR paste a PAT in /settings."
fi

cat <<'EOF'

──────────────────────────────────────────────────────────
  AgentBoard is up.

  • Web:           http://localhost:5173
  • Orchestrator:  http://localhost:3001/api/health
  • Logs:          pnpm logs
  • Stop:          pnpm stop
  • Reset state:   pnpm db:reset (truncates + re-seeds)

  Press ⌘K (Ctrl+K) anywhere for the command palette.
  Press ⌘J (Ctrl+J) to open chat with the team.
──────────────────────────────────────────────────────────
EOF
