# Backend Rules

## API design

- REST routes are nouns, plural, lowercase (`/api/tasks`, not `/api/getTask`).
- 4xx for caller mistakes, 5xx for ours. Never swallow errors silently.
- Validate every request body with Zod (or the project's chosen validator) at the route boundary.

## Database

- All schema changes go through Drizzle migrations. No `db.execute('ALTER TABLE …')` from app code.
- Coordinate with the DBA on any migration that touches a hot table.
- Index foreign keys + the columns you sort/filter by. Run `EXPLAIN` on slow queries.

## Reliability

- External calls (HTTP, Redis, DB) get a timeout. Default 5s, document anything longer.
- Retries: at most twice, with backoff. Idempotent calls only.
- Log structured fields (`agentId`, `taskId`, `requestId`), never `console.log` raw objects.

## Don't

- Don't introduce a new dependency without recording a decision.
- Don't expose internals (DB rows, stack traces) in responses.
- Don't store secrets in the DB. Use env or a secret manager.
