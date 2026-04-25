# Changelog

All notable changes to AgentBoard. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project tracks [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] — 2026-04-25

Big surface release: VSCode-style file browser, deep GitHub integration
(OAuth + webhooks), a new Security Engineer default agent, chat @-mentions,
plus a few /agents and /previews polish passes.

### Added

#### Code viewer
- New "Files" tab on every connected project (`/projects/:id`) — a
  collapsible tree on the left (lazy-loaded per folder) and a
  Prism-highlighted reader on the right with breadcrumb + "open on
  GitHub" link.
- Read-only for now. Path-traversal guard, 1 MB hard cap on inline file
  content, binary detection. Hidden directories (.git, node_modules,
  dist, …) are flagged but not browsed by default.
- Prism theme bound to AgentBoard's CSS tokens so it switches with the
  global light/dark theme.

#### GitHub integration (configurable from the UI)
- New `app_settings` table — first consumer is the GitHub OAuth client
  id/secret, edited from `/settings` by an admin (no `.env` editing
  needed). `.env` still works as a production fallback.
- `<OauthSetupDialog>` walks an admin through registering an OAuth App
  on GitHub, with a one-click copy of the callback URL.
- One-click "Connect with GitHub" button opens the GitHub authorisation
  popup (Vercel/Linear-style). Token stored in `github_connections`
  with mode='oauth'.
- PAT moved under an "Advanced" toggle. `gh` CLI auto-detect kept.
- `github_connections` schema gained `refresh_token`, `token_expires_at`,
  `installation_id` to host the GitHub App flow next.

#### GitHub webhooks
- `POST /api/github/webhook` with HMAC SHA-256 verification (raw-body
  capture installed via `addContentTypeParser`). Allowlisted from
  session auth — GitHub deliveries carry a signature, not a cookie.
- Translates `pull_request`, `push`, `issues`, and `check_run` events
  into the existing UI event bus. PRs ready-for-review and failing
  check_runs also drop a notification message into the team inbox so
  agents react on their next turn.
- `GET /api/github/webhook/config` reports whether webhooks are wired.

#### Default agent: Sage (Security Engineer)
- New `cybersec` role joins the default 8 → 9. Sage reviews PRs through
  an attacker's lens (OWASP top 10, CWE, secret hygiene, dep audit,
  authn/authz changes, schema reviews on PII tables).
- Verdicts are explicit `BLOCK | ADVISE | APPROVE` with cited findings
  and minimal fix suggestions; never gates on style or velocity.
- `agents/cybersec.md` persona + `rules/cybersec.md` operating rules.

#### Chat @-mentions
- New `/api/mentions/search` returns a ranked, type-filterable list of
  candidates (agents, tasks, commits).
- `<MentionTextarea>` swaps in for the plain `<textarea>` in both the
  full Chat page and the floating ChatLauncher. `@` triggers agent
  search, `#` triggers task search; popup is positioned at the caret
  via a hidden mirror div (Cursor / Linear / GitHub-style). ↑/↓/Enter/
  Esc supported. Inserts tokens `@username`, `#task-xxxxxxxx`, or
  `[commit:sha]` so agents see them in plain prompt text.
- Skips email-shaped patterns so pasting an address doesn't open the
  popup.

### Changed

- `/agents` page: filter chips moved to a dedicated row under the page
  header with horizontal scroll. Long titles ("Database Administrator",
  "Language Specialist"…) replaced with short tags (DBA, Language, etc.)
  with role-tinted text. Header no longer overflows when 9 roles are on
  the screen.
- `/previews` got a second polish: header split into two rows (title
  block + toolbar) so the Stop / Start button never gets clipped on
  narrower viewports. Added a viewport switcher (mobile / tablet /
  fluid) for live previews and a copy-URL chip in the toolbar.
- User-menu dropdown is now portalled to `<body>` so it doesn't get
  clipped under the header's `backdrop-blur` stacking context.

### Fixed

- Prism theme leaking generic colours through the rest of the UI.
- Tests for `runAgentTurn` and `create_task` were brittle against the
  budget guard and assignment-message side effects added in 0.2.0.

## [0.2.0] — 2026-04-25

Authentication, RBAC, and a first-run install wizard. Until now anyone
who could reach the orchestrator could drive the agents — this release
puts the platform behind a login.

### Added

#### Authentication + roles
- `users` table (email, username, scrypt password hash, role,
  is_disabled, last_login_at) and server-side `sessions` table with a
  30-day TTL.
- Two roles out of the box: `admin` (manage users, settings, destructive
  ops) and `member` (run the team, edit personas + rules, ship work).
- Cookie-based sessions via `@fastify/cookie`. The cookie carries an
  opaque random token; truth lives in the `sessions` table so revoking
  is just a row delete. `Secure` flag flips on in production.
- Login throttle (10 wrong attempts / 15 min triggers a 1-minute
  cool-off) — per identifier + IP, in-memory.
- Audit log captures `user.created`, `user.login`, `user.password_changed`,
  `user.password_reset`, `user.updated`, `user.deleted`.
- "Last admin" guard refuses to demote / disable / delete the only
  active admin.

#### First-run install wizard
- New `/api/setup/status` returns `{ needsSetup: boolean }`. While true,
  every protected route returns `503 needsSetup`.
- `/api/setup` (one-shot, only callable while uninitialised) creates the
  initial admin and signs them in.
- The web app shows a full-screen `<SetupWizard>` on first visit.

#### Endpoints
- `POST /api/auth/login` — email or username + password, sets cookie.
- `POST /api/auth/logout` — clears cookie + drops session row.
- `GET  /api/auth/me`    — current user or 401.
- `POST /api/auth/password` — change own password (invalidates other
  sessions).
- `GET  /api/users`, `POST /api/users`, `PATCH /api/users/:id`,
  `DELETE /api/users/:id`, `POST /api/users/:id/password` — admin only.

#### Frontend
- Zustand `useAuth` store with explicit phases
  (`loading | needs-setup | logged-out | logged-in`).
- `<AuthGate>` wraps the router and renders splash / wizard / login /
  app based on phase.
- `<UserMenu>` in the top bar with the user's email + role, change-
  password dialog, "Manage users" shortcut for admins, sign out.
- `/users` page — list, invite, role change, enable/disable, password
  reset, delete; mirrors the backend's last-admin guards client-side.
- WebSocket `/ws` does its own handshake auth and closes 4401 on
  unauthenticated connections.
- `lib/api.ts` now sends `credentials: 'include'` so cookies travel
  cross-origin between the web (5173) and the orchestrator (3001).

### Documentation
- README gained a **First-run install wizard** section under Quick start
  and a **Users** entry in the surfaces table.
- `setup.sh` final banner now tells the operator to open the wizard.

## [0.1.0] — 2026-04-25

First public release. The core team-of-agents loop runs end-to-end against
real GitHub repos.

### Added

#### Team of agents
- 8 default roles seeded on first boot — PM, CTO, UI/UX, Language specialist,
  Frontend, Backend, DBA, QA — each a long-lived Claude Agent SDK session
  with its own persona file, git worktree, and inbox.
- Live roster injected into every system prompt, so renamed / new agents are
  visible to the team without restart.
- Per-agent **operating rules** layer (`rules/<role>.md`), edited from the
  agent detail page. Templates pre-loaded for every role.
- Per-agent **runtime tuning** — model (Opus 4.7 / Sonnet 4.6 / Haiku 4.5),
  effort (`off` … `max`), max turns, daily + lifetime cost caps.
- Onboarding briefing on first turn — recent decisions and open work in flight
  are pulled into the prompt so a new teammate ramps without a prologue.

#### MCP tools
- `send_message`, `read_inbox`, `ask_agent`, `request_review`, `list_agents`
- `create_task`, `update_task`, `commit_code`, `open_pr`
- `launch_preview`, `stop_preview`
- `request_approval`, `record_decision`

#### GitHub integration
- Authentication via either the `gh` CLI (auto-detect) or a fine-grained PAT
  pasted in `/settings`.
- `/projects` page — connect a repo, then drill into Pulls / Issues / Branches
  / Tasks per project.
- Tasks bound to a project get a per-task branch
  (`agent/<name>/task-<shortId>`), pushed when the agent calls `open_pr`.
- Inline import of GitHub issues into the kanban.

#### Docker previews
- `launch_preview` brings up the agent's compose project, returns a URL,
  records a row in the `previews` table.
- `/previews` page with grouped Live / Stopped lists, viewport switcher
  (mobile · tablet · desktop), embedded iframe, copyable URL, info drawer
  with port / container id / workdir.
- Preview history is kept after stop — operators can rebuild from the saved
  workdir without re-running the whole task.

#### Web UI
- `/dashboard` — mission control summary.
- `/live` — per-agent swimlanes + animated graph view.
- `/board` — drag-and-drop kanban (5 columns) with task detail dialog.
- `/agents` — roster, persona editor, rules editor, runtime tuning.
- `/timeline` — wire feed of every event.
- `/commits` — diff viewer with PR review modal.
- `/approvals` — human gate for releases / breaking changes.
- `/usage` — **token-first** stats, modelled after Claude Code's `/usage`.
  In subscription mode, falls back to scanning `~/.claude/projects/**/*.jsonl`
  so totals match what the CLI shows. In API-key mode, also reports USD.
- `/settings` — GitHub auth, Slack/Discord/generic webhooks, theme.
- Global `⌘K` command palette + global `⌘J` chat launcher.
- Light / dark themes (white + orange · black + orange).
- Mobile responsive layout (drawer nav, condensed cards).

#### Reliability + safety
- Redis Streams dispatcher with consumer groups + `XAUTOCLAIM`.
- Ack-before-process invariant + dedup per agent — crashes don't leave
  pending entries piling up.
- Wall-clock turn timeout (`AGENT_TURN_TIMEOUT_MS`) so a stalled SDK call
  can never block the dispatcher forever.
- Loop detection (Redis sliding window) inside `send_message`.
- File-level advisory locks via Redis SETNX to avoid concurrent edits in the
  same worktree.
- Hash-chained audit log of every tool call (`/api/audit/verify` to spot
  tampering).
- PreToolUse hook that **blocks** `git push` to default branches,
  `gh pr merge`, `npm publish`, and other destructive bash invocations
  unless an approval row is present.

#### Notifications
- Outbound webhooks (Slack / Discord / generic JSON), filterable by event
  kind, with a `Test` button that posts a fake event to verify wiring.

#### Persistence + dev experience
- Drizzle schema + migrations covering agents, tasks, sprints, messages,
  activity, commits, previews, approvals, projects, github connections,
  usage events, decisions, audit, notifications.
- Optional all-in-one Docker compose `prod` profile
  (`pnpm infra:prod` builds and runs orchestrator + web alongside the
  Postgres + Redis containers used in dev).
- `pnpm db:reset` — wipe the volume, re-migrate, re-seed.
- One-shot installer (`./setup.sh`) — checks prereqs, copies `.env.example`,
  installs deps, brings up infra, migrates, seeds, starts under PM2.

### Documentation
- `README.md` — what / why / quick start.
- `ARCHITECTURE.md` — full design rationale.
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, MIT `LICENSE`.
- `.github/` issue templates, PR template, CI (typecheck + tests).

[Unreleased]: https://github.com/matheusandrades/agentboard/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/matheusandrades/agentboard/releases/tag/v0.3.0
[0.2.0]: https://github.com/matheusandrades/agentboard/releases/tag/v0.2.0
[0.1.0]: https://github.com/matheusandrades/agentboard/releases/tag/v0.1.0
