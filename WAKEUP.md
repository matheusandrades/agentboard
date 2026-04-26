# Wake-up briefing

You went to sleep at ~02:00 BRT on 2026-04-25 with the team running in
**autonomous mode** for a 48h polish sprint. This file is what you read
when you come back.

## TL;DR — first 60 seconds

```bash
gh pr list --repo matheusandrades/agentboard --state all --limit 50
gh run list --repo matheusandrades/agentboard --limit 10
```

Look at:
1. **Open PRs** — they're already reviewed + (likely) merged by alice.
   Triage anything still open.
2. **Failing CI** — if any commit broke `main`, that's the priority.
3. **Cost** — open `/usage` in the web app. Caps are $100/day · $500
   lifetime per agent. If totals look wild, investigate.
4. **Errors** — open `/agents`. Anyone showing red is stuck.

## What changed before you went to bed

### Sprint
- **Sprint name:** "48h polish sprint"
- **9 tasks already on the board**, each assigned to a specialist:

  | # | Task                                              | Owner          | Pri |
  |---|---------------------------------------------------|----------------|-----|
  | 1 | Test coverage: MCP tools                          | quin-qa        | P2  |
  | 2 | Refactor: split runner.ts                         | bruno-backend  | P3  |
  | 3 | Polish: keyboard nav on file tree                 | lucas-frontend | P4  |
  | 4 | Polish: file viewer "Copy path" button            | lucas-frontend | P5  |
  | 5 | Empty-state audit                                 | uma-uiux       | P4  |
  | 6 | Backend: GET /api/health/deep                     | bruno-backend  | P3  |
  | 7 | DX: db:reset clears Redis streams                 | dani-dba       | P5  |
  | 8 | Docs: per-MCP-tool reference                      | leo-langs      | P4  |
  | 9 | Security review: auth + setup                     | sage-cybersec  | P2  |
  | 10| Architecture: dispatcher write-up                 | carl-cto       | P4  |

  Each task description includes acceptance criteria. They're scoped to
  PR-sized work; nothing is "make AgentBoard the best in the world."

### Autonomous mode (no human approval)
- `gh pr merge` is now ALLOWED for agents.
- Local `git merge` to main / master is allowed.
- **Direct `git push` to main / master is still BLOCKED** — agents push
  to `agent/<name>/task-<id>` branches and merge through PRs. Audit
  trail stays clean.
- Force-push to protected branches still blocked.
- `npm publish`, `cargo publish`, `docker push` still blocked
  (release ≠ merge).
- `rm -rf /` still blocked.

### Cost caps
- $100/day per agent, $500 lifetime per agent for the sprint.
- Hard limit; if an agent hits it the runner stops them and posts a
  message in their inbox. Bump caps in `/agents/:id` if needed.

### Per-agent git identity
Every agent's worktree is now configured with their own git
`user.name` / `user.email`. New commits land as
`alice-pm <alice-pm@agentboard.local>` etc, so `git log` in each PR
shows who actually did what.

### Recovery improvements landed
- Stale Claude Code session id auto-recovers (no more "No conversation
  found" errors stuck in red).
- OAuth callback redirect is fixed (no more 3001/settings 404).

## How to triage what they shipped

### For each PR in `gh pr list`:

1. Look at the author. Each agent commits as themselves; merges show up
   under your account (since `gh` uses your token).
2. Check the description — agents write a "Why" + "What changed"
   section automatically when they call `open_pr`.
3. If checks are green and the diff makes sense → leave it merged.
4. If a check failed and the PR was merged anyway → revert + re-open
   the task.
5. If a PR is still open with a "request changes" review, the agent
   probably ran out of turns. Either:
   - Reply on the PR (the cybersec / cto agent will read it next dispatch)
   - Or bump the daily cap and let them keep going

### If anything looks off

```bash
# Live status of every agent
curl -s http://localhost:3001/api/agents | jq '.[] | {name, status, last: .lastLoginAt}'

# Recent activity
open http://localhost:5173/timeline

# Token spend by agent
open http://localhost:5173/usage

# Pending approvals (informational, no longer blocking)
open http://localhost:5173/approvals
```

### Kill switch

If anything is loose:

```bash
npx pm2 stop orchestrator    # stops all agent dispatches
```

Re-enable with `npx pm2 start orchestrator`.

To pause **just one** agent without stopping the whole platform:

```bash
docker exec agentboard-postgres psql -U agentboard -d agentboard \
  -c "UPDATE agents SET status='blocked' WHERE name='<agent-name>';"
```

The dispatcher skips agents with status `blocked` until you flip them
back to `idle`.

## What this is NOT

- Not magic. The team will produce maybe 5–10 PRs of useful work in
  48h, not a finished platform.
- Not a substitute for human review at merge time. They'll merge
  what their PM says is ready; that's the trust contract.
- Not free. Look at `/usage` first thing. If totals shocked you, lower
  the caps and re-launch a tighter sprint.

## Re-launching the sprint (if it stalled)

```bash
# From repo root:
corepack pnpm --filter @agentboard/orchestrator exec tsx ../../scripts/scale_autonomous.ts
```

Re-runs the autonomous mode primer, bumps caps, re-pings the PM.

## Adding follow-up tasks

```bash
corepack pnpm --filter @agentboard/orchestrator exec tsx ../../scripts/seed_48h_sprint.ts
```

Edit the `TASKS` array at the top of the file before running.
