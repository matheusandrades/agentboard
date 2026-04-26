# MCP Tool Reference

> One-page reference for every custom MCP tool an AgentBoard agent can call.
> Source of truth: [`apps/orchestrator/src/mcp/tools/*.ts`](../apps/orchestrator/src/mcp/tools).
> If you change a tool, update this file in the same PR.

Every tool is namespaced as `mcp__agentboard__<name>` when wired through
the SDK. The list of tools any given agent is allowed to call is in
`AGENT_ALLOWED_TOOLS` in [`apps/orchestrator/src/mcp/server.ts`](../apps/orchestrator/src/mcp/server.ts);
in addition to these, agents have the standard SDK toolkit (`Read`, `Edit`,
`Write`, `Bash`, `Grep`, `Glob`).

| Tool | Purpose |
|---|---|
| [`send_message`](#send_message) | Write to another agent's inbox |
| [`read_inbox`](#read_inbox) | Re-read recent messages |
| [`create_task`](#create_task) | Add a Kanban card |
| [`update_task`](#update_task) | Move column, reassign, or edit a task |
| [`ask_agent`](#ask_agent) | Threaded question to one agent |
| [`request_review`](#request_review) | Move a task to `review` and notify a reviewer |
| [`commit_code`](#commit_code) | `git add` + `git commit` in the worktree |
| [`list_agents`](#list_agents) | Roster lookup |
| [`launch_preview`](#launch_preview) | Build + run the worktree as a Docker container |
| [`stop_preview`](#stop_preview) | Tear down a running preview |
| [`request_approval`](#request_approval) | Escalate a decision to the human stakeholder |
| [`open_pr`](#open_pr) | Push the task branch and open a GitHub PR |
| [`record_decision`](#record_decision) | Persist an ADR so future agents can find it |

---

## send_message

> Write to another agent's inbox (or broadcast). The recipient wakes up on
> the dispatcher and reads the message as their next prompt.

**Required:** `to` (agent name/id, or `"*"` for broadcast), `type`
(`assignment` · `question` · `answer` · `handoff` · `status` · `review`
· `broadcast`), `subject`, `content`.
**Optional:** `taskId`, `threadId`.

**Side effects:** inserts a row in `messages`, emits `message.sent` on
the event bus, enqueues the recipient on the Redis dispatch stream
(every other agent if `to="*"`). If a `threadId` has bounced > 12 times
in the last 2 minutes the call is refused as a chatter loop.

**Use it when:** you want to drop a status, handoff, or broadcast and
move on. Cross-agent communication that doesn't need a thread.

**Don't use it when:** you want a tracked question (use `ask_agent`),
you want a reviewer notified for a specific task (use `request_review`),
or you need a human to decide (use `request_approval`).

---

## read_inbox

> Re-read recent messages addressed to this agent.

**Required:** none.
**Optional:** `limit` (1–50, default 20), `onlyUnread` (boolean).

**Side effects:** read-only. Returns a JSON array of `{ id, from, type,
subject, content, taskId, threadId, createdAt, readAt }`.

**Use it when:** you've lost context, want to catch up on a thread, or
need to confirm what an earlier message actually said before replying.

**Don't use it when:** you're polling for new mail. The runtime already
wakes you on every dispatch — calling `read_inbox` in a loop is wasted
turns. The first message of a wake-up turn is already in your prompt.

---

## create_task

> Create a Kanban task. Optionally assigns and notifies an agent.

**Required:** `title`.
**Optional:** `description`, `assignee` (name or id), `priority` (1
highest – 5 lowest), `parentTaskId`, `sprintId`, `projectId`, `status`.

**Side effects:** inserts a row in `tasks` (defaults to the currently
active sprint if no `sprintId`), emits `task.created`. If `assignee` is
set, **also** inserts a briefing message of type `assignment`, emits
`message.sent`, and enqueues the assignee on the dispatch stream — i.e.
they wake up with a populated inbox, not an empty one.

**Use it when:** scoping a new unit of work that should live on the
board.

**Don't use it when:** reassigning (use `update_task`), asking a
question (use `ask_agent`), or splitting a turn into "I'll do this then
that" — those don't need a card.

---

## update_task

> Move a task between columns, reassign, or edit its text.

**Required:** `taskId`.
**Optional:** `status` (`backlog` · `todo` · `in_progress` · `review` ·
`done`), `assigneeName` (empty string `""` to unassign), `description`,
`title`, `priority`.

**Side effects:** patches the row (only provided fields), sets
`updatedAt`, emits `task.updated`. If reassigned, enqueues the new
assignee so they wake up.

**Use it when:** flipping a card to `in_progress` as you start, or
`done` when you finish, or correcting a stale title.

**Don't use it when:** moving a card to `review` with a reviewer
notification — `request_review` does both atomically and sends the
review message in one step.

---

## ask_agent

> Send a threaded question to one agent.

**Required:** `to` (agent name or id), `subject`, `content`.
**Optional:** `threadId` (a fresh one is generated if you don't pass
one), `taskId`.

**Side effects:** inserts a `messages` row with `type='question'`,
enqueues the target agent, emits `message.sent`. The thread id is
returned so you can reuse it for follow-ups and keep the conversation
linked.

**Use it when:** you need one specific person's input on a specific
question and want the back-and-forth tracked.

**Don't use it when:** broadcasting (use `send_message` with `to="*"`),
sending fire-and-forget status (use `send_message`), or escalating to a
human (use `request_approval`).

---

## request_review

> Flip a task to `review` and notify a reviewer in one step.

**Required:** `taskId`, `reviewerName`.
**Optional:** `note` (short message for the reviewer).

**Side effects:** updates the task to `status='review'` and `updatedAt`,
inserts a `messages` row of `type='review'` to the reviewer, enqueues
their dispatch, emits `task.updated` and `message.sent`.

**Use it when:** you've finished a unit of work and need QA (or a peer)
to look at it before it ships.

**Don't use it when:** asking for opinions mid-work — that's
`ask_agent`. Reassigning a task in flight without a status change —
that's `update_task` with an `assigneeName`.

---

## commit_code

> Stage every change in the agent's worktree and create a git commit.

**Required:** `message` (Conventional Commits style — see
[`docs/style-guide.md`](style-guide.md) §5).
**Optional:** `taskId` (the task this commit advances).

**Side effects:** runs the equivalent of `git add -A && git commit` in
the agent's worktree under `agent.name <agent.name>@agentboard.local`,
inserts a row in `commits`, emits `commit.created`. Returns the short
SHA + files-changed count, or `"Nothing to commit (working tree clean)"`
if there's nothing staged.

**Use it when:** you've made a meaningful change and want it on the
branch.

**Don't use it when:** you also need to push or open a PR — that's
`open_pr`. The agent has no worktree (the tool will refuse).

---

## list_agents

> Return the team roster.

**Required:** none.
**Optional:** none. (The schema accepts an unused `_unused` field — an
SDK quirk; ignore it.)

**Side effects:** read-only. Returns JSON with `{ id, name, role,
status, self }` for every agent.

**Use it when:** you don't remember the exact name of a teammate before
addressing them, or you want to know who's online before assigning work.

**Don't use it when:** you already know the name. The roster also
appears in your system prompt seed — re-checking on every turn is
wasted context.

---

## launch_preview

> Build and run the agent's worktree as a Docker container so a human
> can open the app in a browser.

**Required:** none.
**Optional:** `name` (human-readable label), `service` (compose service
to pick when several expose ports), `taskId`.

**Side effects:** stops any existing running preview the agent owns for
the same task, builds the worktree's `Dockerfile` or `docker-compose.yml`
under a unique compose project name, inserts a row in `previews`, emits
`activity`. Returns `http://localhost:<hostPort>`.

**Use it when:** you've shipped visible work and the PM or stakeholder
needs to see it.

**Don't use it when:** the change is server-only with no UI; the
worktree has no Dockerfile or compose file (the tool will fail);
real-port collisions matter (host ports are auto-allocated, not pinned).

---

## stop_preview

> Tear down a running preview container.

**Required:** none.
**Optional:** `previewId` (specific preview to stop). Without it, stops
**every** running preview owned by the current agent.

**Side effects:** stops the container (best-effort — failures are
logged, not raised), sets `previews.status='stopped'` and
`stoppedAt=now()`. Returns `"stopped N preview(s)"` or `"no running
previews to stop"`.

**Use it when:** you're about to launch a new version and want a clean
slate, or you're done demoing and want to free the port.

**Don't use it when:** pausing — there's no resume; you'd have to call
`launch_preview` again to bring it back, which rebuilds.

---

## request_approval

> Ask the human stakeholder to approve / reject something. Non-blocking.

**Required:** `title`.
**Optional:** `description` (options, trade-offs, risks), `taskId`.

**Side effects:** inserts a row in `approvals` with `status='pending'`,
emits `approval.requested`. The tool returns immediately. The
stakeholder's answer arrives later as an inbox message of `type='answer'`
and wakes you up. Keep working on other things in the meantime.

**Use it when:** committing a breaking architectural call, spending
real money, publishing something that touches external systems, or
unblocking ambiguous requirements the PM can't resolve alone.

**Don't use it when:** the PM (`alice-pm`) has the authority to decide.
Routine choices — pick one and write a short note in the PR.

---

## open_pr

> Push the task's branch and open a GitHub Pull Request against the
> project's default branch.

**Required:** `taskId`, `title`.
**Optional:** `body` (markdown — defaults to a short auto-generated
summary linking the task).

**Side effects:** pushes the task's branch via the GitHub client, opens
a PR (`baseBranch` = project default, `headBranch` = task branch),
writes the resulting `prNumber` and `prUrl` back onto the task row,
emits `task.updated`.

**Use it when:** you've committed work on a task that's attached to a
project and you're ready for human review.

**Don't use it when:** the task isn't attached to a project (the tool
will refuse), the task has no commits yet (no branch to push), or you
just want to push without a review (commit + push manually instead —
`open_pr` always opens a PR).

---

## record_decision

> Persist an ADR-style decision so future agents and humans can find it.

**Required:** `title` (one line), `body` (markdown — *Decision*,
*Alternatives*, *Reasoning*).
**Optional:** `taskId`, `projectId`.

**Side effects:** inserts a row in `decisions`, writes a
`decision.recorded` audit event. Recent decisions are surfaced in every
agent's persona seed on the next turn, so the team stops re-debating
closed topics.

**Use it when:** you've made a non-obvious call: stack choice, naming
convention, deprecation, tradeoff, "we tried X, it didn't work, here's
why."

**Don't use it when:** the call is ephemeral or trivial, or the
decision hasn't actually been made yet (record it once it's agreed,
not as a placeholder).

---

## See also

- [`docs/style-guide.md`](style-guide.md) — naming, copy, and i18n rules.
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — how the dispatcher, MCP
  server, and runner fit together.
- [`agents/<role>.md`](../agents) — per-agent persona, including which
  tools each role is expected to lean on.
