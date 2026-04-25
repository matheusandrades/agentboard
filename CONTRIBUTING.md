# Contributing to AgentBoard

Thanks for considering a contribution! AgentBoard is a young project and we
care more about clean, small, well-tested changes than about volume.

## Dev loop

```bash
git clone https://github.com/<you>/agentboard.git
cd agentboard
./setup.sh                       # postgres + redis + migrate + seed + pm2
pnpm logs                        # watch live
```

Hot reload:

- The orchestrator runs under `tsx watch` via PM2; saves trigger a fast restart.
- The web app is `vite dev` — every change hot-reloads.

## Layout reminder

| | |
|---|---|
| `agents/*.md` | Persona prompts. Editing here changes the team's behavior. |
| `apps/orchestrator/src/agents/runner.ts` | The heart — one turn per dispatched message. |
| `apps/orchestrator/src/mcp/tools/*` | The custom tools agents can call. New capabilities live here. |
| `apps/orchestrator/src/api/http.ts` | REST endpoints. |
| `apps/orchestrator/src/db/schema.ts` | Drizzle schema. |
| `apps/web/src/pages/*` | Pages. Each one tries to be self-contained. |
| `packages/shared/src/*` | Types + zod schemas reused by both apps. |

## Code style

- TypeScript everywhere, ESM modules.
- No `any`. If a third-party type is hostile, narrow with a Zod parse.
- Prefer named exports; default-only exports are reserved for components.
- Comments explain **why**, not **what**. Function names should make `what` obvious.
- Tests use Vitest and live next to the code as `*.test.ts(x)`.

## Adding a new MCP tool

1. Create `apps/orchestrator/src/mcp/tools/<your_tool>.ts` — export `yourTool(currentAgentId)` returning the SDK `tool(...)` instance.
2. Add it to the `tools: [...]` list in `apps/orchestrator/src/mcp/server.ts`.
3. Add the namespaced name (`mcp__agentboard__<your_tool>`) to `AGENT_ALLOWED_TOOLS` in the same file.
4. Update the tool inventory in the relevant persona files (`agents/<role>.md`).
5. Write at least one Vitest test that mocks the DB and verifies the success and error paths.

## Adding a new agent role

1. Add the role to `AgentRoleSchema` and `AGENT_ROLES` in `packages/shared/src/agents.ts`.
2. Add an avatar gradient + tint + ring in `apps/web/src/lib/roles.ts`.
3. Pick a portrait in `apps/web/public/avatars/` and map it in `ROLE_PORTRAIT`.
4. Drop a `agents/<role>.md` persona that follows the existing structure (Identity, Responsibilities, Tools, How you work, Teammates, Golden rules).
5. Run a fresh `pnpm db:seed` — the seeder picks up the new role automatically.

## Database changes

We use Drizzle.

```bash
# Edit apps/orchestrator/src/db/schema.ts, then:
cd apps/orchestrator
pnpm exec drizzle-kit generate    # writes a SQL file under drizzle/
pnpm exec tsx src/db/migrate.ts   # applies it
```

Migrations are checked into git. Don't edit existing migration files — write a new one.

## Pull requests

1. Branch off `main`.
2. Keep changes focused. One PR per logical unit.
3. Run `pnpm typecheck` and `pnpm test` locally.
4. Write a clear PR description: **what** changed, **why**, and **how to test**.
5. Reviews look for correctness first, style second, polish third.

## Reporting issues

Bug reports are most useful when they include:

- AgentBoard commit SHA (`git rev-parse HEAD`)
- Node version (`node -v`)
- A minimal reproduction (which page, which click, what you expected, what happened)
- Relevant log snippets (`pnpm logs --lines 200`)

## Security

Found a vulnerability? Please **don't** open a public issue. Email the
maintainers directly (see `package.json#author` or the GitHub repo
description). We'll respond within 72 hours.

## License

By contributing you agree your work is licensed under the [MIT License](LICENSE).
