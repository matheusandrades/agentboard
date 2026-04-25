# AgentBoard — Architecture

Open-source multi-agent engineering team visualized as a Scrum/Kanban board. Each "team member" is a long-lived Claude Agent SDK session with a persona `.md`, an inbox/outbox, and the ability to commit code, create tasks, and talk to peers. A simple web UI shows the board updating in real time as agents collaborate.

---

## 1. High-level diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                         Browser (UI)                             │
│  Kanban | Agents | Timeline | Chat with agent                    │
└───────────────────────▲──────────────────────▲───────────────────┘
                        │ WebSocket            │ REST
┌───────────────────────┴──────────────────────┴───────────────────┐
│                       Orchestrator (Node.js)                     │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ HTTP/WS API  │  │ Agent Runner │  │ Message Dispatcher    │  │
│  │ (Fastify)    │  │ (SDK calls)  │  │ (Redis Streams)       │  │
│  └──────────────┘  └──────┬───────┘  └──────────┬────────────┘  │
│                           │                     │                │
│                           ▼                     ▼                │
│                  ┌─────────────────────────────────────┐        │
│                  │       Custom MCP (inline tools)     │        │
│                  │  send_message, update_task, commit… │        │
│                  └─────────────────┬───────────────────┘        │
└────────────────────────────────────┼────────────────────────────┘
        │                            │                  │
        ▼                            ▼                  ▼
   ┌─────────┐               ┌──────────────┐   ┌───────────────┐
   │Postgres │               │    Redis     │   │ Git Worktrees │
   │(state)  │               │(queue+pubsub)│   │ (per agent)   │
   └─────────┘               └──────────────┘   └───────────────┘
```

**Central principle:** agents are **reactive**, not "always alive". Each inbox message triggers a `query()` call that resumes the previous session via `sessionId`. The SDK preserves full conversational context; the database only stores the pointer (`session_id`) plus a human-readable history.

---

## 2. Stack

| Layer | Choice |
|-------|--------|
| Backend | Node 20+ / TypeScript, **Fastify** |
| SDK | `@anthropic-ai/claude-agent-sdk` |
| Realtime | Fastify + `@fastify/websocket` |
| DB | PostgreSQL 16 + **Drizzle ORM** |
| Queue/Bus | Redis 7 — Streams (inbox) + Pub/Sub (UI events) |
| Frontend | **Vite + React + TailwindCSS** |
| Kanban UI | `@dnd-kit/core` |
| Validation | `zod` (shared between front/back) |
| Testing | `vitest` (unit + integration) |
| Process manager | **PM2** (dev + prod, auto-restart, logs aggregation) |
| Local infra | **docker-compose** (Postgres + Redis; optionally orchestrator/web for prod) |
| Monorepo | `pnpm` workspaces |

---

## 3. Folder structure

```
agentboard/
├── apps/
│   ├── orchestrator/              # Backend
│   │   ├── src/
│   │   │   ├── index.ts           # Fastify bootstrap
│   │   │   ├── api/
│   │   │   │   ├── http.ts        # REST routes
│   │   │   │   └── ws.ts          # WebSocket
│   │   │   ├── agents/
│   │   │   │   ├── runner.ts      # Runs one turn via SDK
│   │   │   │   ├── persona.ts     # Loads .md → systemPrompt
│   │   │   │   └── dispatcher.ts  # Reads Streams, routes to runner
│   │   │   ├── mcp/
│   │   │   │   ├── server.ts      # createSdkMcpServer
│   │   │   │   └── tools/
│   │   │   │       ├── send_message.ts
│   │   │   │       ├── update_task.ts
│   │   │   │       ├── create_task.ts
│   │   │   │       ├── ask_agent.ts
│   │   │   │       ├── read_inbox.ts
│   │   │   │       ├── commit_code.ts
│   │   │   │       ├── request_review.ts
│   │   │   │       └── list_agents.ts
│   │   │   ├── hooks/
│   │   │   │   ├── activity.ts    # PostToolUse → log + broadcast
│   │   │   │   └── session.ts     # Stop → idle + persist session
│   │   │   ├── worktree/manager.ts
│   │   │   ├── db/
│   │   │   │   ├── schema.ts      # Drizzle schema
│   │   │   │   └── client.ts
│   │   │   ├── redis/
│   │   │   │   ├── streams.ts
│   │   │   │   └── pubsub.ts
│   │   │   └── events/bus.ts
│   │   └── package.json
│   └── web/                       # Frontend
│       ├── src/
│       │   ├── main.tsx
│       │   ├── pages/
│       │   │   ├── Board.tsx
│       │   │   ├── Agents.tsx
│       │   │   ├── Timeline.tsx
│       │   │   └── AgentChat.tsx
│       │   ├── components/
│       │   └── lib/{api.ts,ws.ts}
│       └── package.json
├── packages/
│   └── shared/                    # Shared types (zod schemas)
│       └── src/{messages.ts,tasks.ts,events.ts,index.ts}
├── agents/                        # Personas
│   ├── pm.md   cto.md   ui-ux.md
│   ├── lang-specialist.md
│   ├── frontend.md   backend.md
│   ├── dba.md  qa.md
├── workspace/                     # Git worktrees (gitignored)
├── docker-compose.yml
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .env.example
└── README.md
```

---

## 4. Postgres schema

```sql
CREATE TABLE agents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(100) UNIQUE NOT NULL,
  role          VARCHAR(50)  NOT NULL,
  persona_path  TEXT NOT NULL,
  session_id    TEXT,                              -- SDK session (context pointer)
  status        VARCHAR(20) DEFAULT 'idle',        -- idle|working|blocked|error
  worktree_path TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE sprints (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(200) NOT NULL,
  goal        TEXT,
  status      VARCHAR(20) DEFAULT 'active',
  started_at  TIMESTAMPTZ,
  ends_at     TIMESTAMPTZ
);

CREATE TABLE tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sprint_id     UUID REFERENCES sprints(id),
  title         VARCHAR(500) NOT NULL,
  description   TEXT,
  status        VARCHAR(20) DEFAULT 'backlog',     -- backlog|todo|in_progress|review|done
  assignee_id   UUID REFERENCES agents(id),
  created_by    UUID REFERENCES agents(id),
  priority      INT DEFAULT 3,
  parent_id     UUID REFERENCES tasks(id),
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_agent_id UUID REFERENCES agents(id),       -- NULL = stakeholder
  to_agent_id   UUID REFERENCES agents(id),       -- NULL = broadcast
  thread_id     UUID,
  task_id       UUID REFERENCES tasks(id),
  type          VARCHAR(30) NOT NULL,
  subject       VARCHAR(500),
  content       TEXT NOT NULL,
  metadata      JSONB,
  delivered_at  TIMESTAMPTZ,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE commits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      UUID REFERENCES agents(id),
  task_id       UUID REFERENCES tasks(id),
  sha           VARCHAR(40) NOT NULL,
  branch        VARCHAR(200),
  message       TEXT,
  files_changed INT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE activity_log (
  id          BIGSERIAL PRIMARY KEY,
  agent_id    UUID REFERENCES agents(id),
  event_type  VARCHAR(50) NOT NULL,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_messages_to_unread ON messages(to_agent_id, read_at) WHERE read_at IS NULL;
CREATE INDEX idx_tasks_status ON tasks(status, sprint_id);
CREATE INDEX idx_activity_recent ON activity_log(created_at DESC);
```

---

## 5. Redis layout

| Key / Stream | Purpose | Type |
|---|---|---|
| `agent:{agentId}:inbox` | Per-agent queue of pending messages | Stream |
| `dispatch:queue` | Global queue of agent IDs with pending work | Stream (consumer group `orchestrator`) |
| `events:ui` | UI broadcast channel | Pub/Sub |
| `agent:{agentId}:lock` | Prevents concurrent turns for same agent | String (SETNX + TTL 30s) |

Streams (not Lists) give us consumer groups: reliable processing, retry, XACK — critical if the orchestrator crashes mid-turn.

---

## 6. Message format

```ts
// packages/shared/src/messages.ts
export type MessageType =
  | 'assignment' | 'question' | 'answer'
  | 'handoff'    | 'status'   | 'review'
  | 'broadcast';

export interface AgentMessage {
  id: string;
  from: string;          // agent name or "stakeholder"
  to: string | '*';      // '*' = broadcast
  threadId?: string;
  taskId?: string;
  type: MessageType;
  subject: string;
  content: string;       // becomes the user prompt passed to SDK
  metadata?: Record<string, unknown>;
  createdAt: string;
}
```

---

## 7. Agent lifecycle — the core

### 7.1 Creation (once)
```ts
export async function bootAgent(role: string, name: string) {
  const worktree = await createWorktree(name);
  await db.insert(agents).values({
    name, role,
    persona_path: `agents/${role}.md`,
    worktree_path: worktree,
    session_id: null,
  });
}
```

### 7.2 Dispatcher loop
```ts
async function dispatchLoop() {
  while (true) {
    const entry = await redis.xreadgroup(/* blocking */);
    if (!entry) continue;
    const { agentId } = entry.data;
    const lock = await acquireLock(`agent:${agentId}:lock`, 30_000);
    if (!lock) continue;
    try {
      await runAgentTurn(agentId);
      await redis.xack(/* ... */);
    } finally { await releaseLock(lock); }
  }
}
```

### 7.3 Running one turn (context preservation)
```ts
import { query } from '@anthropic-ai/claude-agent-sdk';

export async function runAgentTurn(agentId: string) {
  const agent = await db.query.agents.findFirst({ where: eq(agents.id, agentId) });
  const persona = await fs.readFile(agent.persona_path, 'utf-8');

  const unread = await getUnreadMessages(agentId, 20);
  if (unread.length === 0) return;

  const prompt = formatInboxAsPrompt(unread);
  await setAgentStatus(agentId, 'working');

  let newSessionId: string | undefined;
  for await (const msg of query({
    prompt,
    options: {
      systemPrompt: persona,                 // replaces default system prompt
      resume: agent.session_id ?? undefined, // ← CONTEXT PRESERVED ACROSS TURNS
      cwd: agent.worktree_path,
      mcpServers: { agentboard: buildMcpServer(agentId) },
      allowedTools: [
        'mcp__agentboard__send_message',
        'mcp__agentboard__update_task',
        'mcp__agentboard__create_task',
        'mcp__agentboard__read_inbox',
        'mcp__agentboard__commit_code',
        'mcp__agentboard__ask_agent',
        'mcp__agentboard__request_review',
        'mcp__agentboard__list_agents',
        'Read','Edit','Write','Bash','Grep','Glob',
      ],
      permissionMode: 'acceptEdits',
      hooks: {
        PostToolUse: [{ matcher: '.*', hooks: [activityHook(agentId)] }],
      },
      maxTurns: 25,
    },
  })) {
    if (msg.type === 'result') newSessionId = msg.session_id;
  }

  if (newSessionId) {
    await db.update(agents).set({ session_id: newSessionId }).where(eq(agents.id, agentId));
  }
  await markMessagesRead(unread);
  await setAgentStatus(agentId, 'idle');
}
```

**Key point:** passing `resume: sessionId` makes the SDK load the entire prior conversation (system prompt, prior prompts, tool calls, Claude's responses). The DB stores only the pointer.

---

## 8. Custom MCP tools

Registered inline via `createSdkMcpServer` — zero extra processes.

| Tool | Purpose |
|---|---|
| `send_message` | Write to another agent's inbox |
| `read_inbox` | Re-read recent messages |
| `create_task` | Kanban card |
| `update_task` | Move column / reassign |
| `ask_agent` | Q&A variant (thread-tracked) |
| `request_review` | Create review task for QA |
| `commit_code` | `git add` + `git commit` in agent's worktree |
| `list_agents` | Discover teammates |

Claude Code native tools (Read/Edit/Write/Bash/Grep) remain available for real code work.

---

## 9. Hooks

```ts
export const activityHook = (agentId: string) => async (input, toolUseID) => {
  await db.insert(activityLog).values({
    agent_id: agentId,
    event_type: 'tool_call',
    payload: { tool: input.tool_name, toolUseID, args: input.tool_input, result: input.tool_response },
  });
  publishUI({ type: 'activity', agentId, tool: input.tool_name });
  return { continue: true };
};
```

`PostToolUse` with matcher `.*` captures every agent action → UI timeline becomes real-time, no polling.

---

## 10. HTTP + WebSocket API

### REST
```
GET    /api/agents
POST   /api/agents
DELETE /api/agents/:id
GET    /api/agents/:id

GET    /api/tasks?sprint=:id
POST   /api/tasks
PATCH  /api/tasks/:id

GET    /api/sprints
POST   /api/sprints

POST   /api/messages           # stakeholder → agent
GET    /api/messages?agent=:id

GET    /api/activity?limit=100
GET    /api/commits?agent=:id
```

### WebSocket `/ws`
Server pushes: `agent.status`, `task.updated`, `message.sent`, `commit.created`, `activity`.

---

## 11. Frontend

**Routes:**
- `/board` — Kanban (drag & drop moves task, notifies assignee)
- `/agents` — agent grid with status, current task, inbox count
- `/agents/:id` — detail: conversations, commits, personal timeline
- `/timeline` — global feed
- `/chat` — stakeholder sends messages to any agent
- `/sprints` — admin

**Key components:** `<KanbanBoard>`, `<TaskCard>`, `<AgentCard>`, `<MessageBubble>`, `<ActivityItem>`.

**Not included in MVP:** auth, i18n, themes.

---

## 12. Phases

| Phase | Scope | Done when |
|---|---|---|
| **1 — Skeleton** | Docker Compose, Drizzle migrations, Fastify boot, single PM agent replying via SDK with `resume` working | Stakeholder sends "Hi" → PM replies → session_id persisted in DB |
| **2 — Two-agent chat** | PM + 1 dev. `send_message` MCP tool. Redis Streams + dispatcher | Stakeholder says "create task X", PM creates + assigns, dev responds |
| **3 — UI mínima** | Vite + React, WebSocket, read-only Kanban + Agents + Timeline | Board updates live while agents talk |
| **4 — Full team + git** | All 8 roles, worktree per agent, `commit_code`, commits in UI | Full cycle: goal → tasks → commits → QA review → done |
| **5 — Polish** | DnD Kanban, stakeholder chat, sprints, error retry | Presentable demo |
| **6 — Open source** | README, CONTRIBUTING, CI, Dockerfile, MIT license | GitHub-ready |

---

## 13. Local dev & deploy (Docker + PM2)

**Two-tier setup that keeps dev friction low:**

### docker-compose (infrastructure only for dev)
Runs **Postgres + Redis** as long-lived containers. Not the Node apps — those run under PM2 on the host so that file watching, breakpoints, and hot reload work naturally.

```yaml
# docker-compose.yml (simplified)
services:
  postgres:
    image: postgres:16
    environment: { POSTGRES_USER: agentboard, POSTGRES_PASSWORD: agentboard, POSTGRES_DB: agentboard }
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    volumes: [redisdata:/data]
volumes: { pgdata: {}, redisdata: {} }
```

A profile `prod` also ships **orchestrator + web** as containerized services with their own Dockerfiles for production deployment.

### PM2 (orchestrator + web processes)
PM2 handles supervision, restart-on-crash, log aggregation, clustering (if needed), and zero-downtime reload.

```js
// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'orchestrator',
      cwd: './apps/orchestrator',
      script: 'pnpm',
      args: 'dev',
      env: { NODE_ENV: 'development' },
      watch: false,        // tsx already watches
      max_memory_restart: '1G',
    },
    {
      name: 'web',
      cwd: './apps/web',
      script: 'pnpm',
      args: 'dev',
      env: { NODE_ENV: 'development' },
      watch: false,
    },
  ],
};
```

### Commands (via root `package.json` scripts)

```bash
pnpm run infra:up        # docker compose up -d (postgres + redis)
pnpm run infra:down      # docker compose down
pnpm run infra:logs      # tail docker logs

pnpm run db:migrate      # drizzle-kit push
pnpm run db:seed         # seeds 8 agents + demo sprint

pnpm run start           # pm2 start ecosystem.config.cjs
pnpm run stop            # pm2 stop all
pnpm run logs            # pm2 logs
pnpm run monit           # pm2 monit (dashboard)
pnpm run restart         # pm2 restart all

pnpm run test            # vitest across all workspaces

pnpm run dev             # infra:up && db:migrate && start   (one-liner)
```

### Production option
`docker compose --profile prod up -d` builds and runs orchestrator + web alongside Postgres/Redis. PM2 still runs **inside** the orchestrator container (single source of truth for restart policy).

---

## 14. Risks

1. **Infinite loops** between agents → `maxTurns` + circular-thread detection
2. **Cost** of 8 active agents → rate limits per agent, low `maxTurns`
3. **Merge conflicts** between worktrees → per-agent branches; PM/QA merges
4. **Bad session_id** (version drift or token limit) → on SDK error, start fresh session
5. **Stakeholder as agent?** → MVP: just a `from` field; UI notifies user for direct questions
