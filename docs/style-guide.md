# AgentBoard Style Guide

> Owner: **leo-langs**. PRs that touch user-facing copy, public APIs, error
> messages, or naming conventions should be reviewed against this document.
> If something here is wrong, fix it here first — don't carry the inconsistency
> into your PR.

This guide is short on purpose. It exists so the team writes code, errors,
and docs the same way. When in doubt, prefer **clear over clever** and
**specific over generic**.

---

## 1. Voice & tone

AgentBoard is a piece of operations software for engineers. The voice is:

- **Calm.** No exclamation marks, no hype. The product runs autonomous agents
  with real money attached — users want to feel in control, not entertained.
- **Specific.** Say *what* happened and *what to do next*. "Something went
  wrong" is never acceptable copy.
- **Human, not corporate.** Contractions are fine ("don't", "won't"). No
  "kindly", no "please be advised", no "we're sorry for the inconvenience".
- **Honest.** If a feature is unfinished, say so ("Drag to Done to archive —
  hard delete is not implemented yet"). Don't pretend.

Marketing copy on the README is allowed to be a little warmer ("a small
autonomous engineering organisation"). In-app strings stay matter-of-fact.

---

## 2. Naming

### Golden rule

**Names should not lie.** `getUsers()` returns users. `isAdmin` is a boolean.
`fetchProject` makes a network call; `selectProject` does not. If the body
of a function changes shape, rename it.

### TypeScript identifiers

| Kind | Convention | Example |
|---|---|---|
| Variables, params, functions | `camelCase` | `currentAgentId`, `dispatchMessage` |
| React components, classes, types, interfaces | `PascalCase` | `TaskDetailDialog`, `AgentRoleSchema` |
| Constants (module-level config, env-derived) | `SCREAMING_SNAKE_CASE` | `AGENT_ALLOWED_TOOLS`, `MAX_RETRIES` |
| Files | `kebab-case.ts` for libs, `PascalCase.tsx` for components | `pricing.ts`, `TaskDetailDialog.tsx` |
| Test files | `<thing>.test.ts(x)` next to the source | `pricing.test.ts` |
| Generics | Single letter `T`/`K`/`V` for trivial; `TFoo` for meaningful | `<TPayload>` |

### Booleans

- Prefix with `is`, `has`, `can`, `should`, `did`. Never just the noun.
- `isAdmin` ✅ — `admin` ❌ — `userIsAdmin` ❌ (redundant subject).
- Negative names are forbidden: use `isVisible: false`, never `isHidden: true`
  paired with another `isVisible` somewhere else.

### Functions

- Verb-first: `loadAgents`, `commitCode`, `requestApproval`.
- Async functions don't need `Async` suffix unless a sync sibling exists.
- Event handlers: `handle<Subject><Action>` — `handleTaskDrop`, not
  `onTaskDrop` (which is reserved for the prop name) or `taskDropHandler`.
- Pure mappers / selectors: noun-first — `agentToAvatar`, `taskToBranchName`.

### Routes (HTTP + frontend)

- REST: `kebab-case`, plural nouns, no verbs in the path.
  `/api/agents/:id/messages` ✅ — `/api/getAgentMessages` ❌.
- Frontend routes: `kebab-case`, lowercase. Match the noun the page
  represents (`/board`, `/agents`, `/approvals`).

### Database (Drizzle)

- Table names: `snake_case`, plural — `task_comments`, `audit_events`.
- Column names: `snake_case`. Booleans named with the same `is_/has_` rule
  as TypeScript: `is_admin`, `has_approval`.
- Foreign keys: `<table>_id` — `agent_id`, `task_id`. Never just `id_agent`.

### Log fields & event names

- Log keys: `snake_case` — `agent_id`, `task_id`, `tool_name`. Easier to
  query in JSON logs.
- Telemetry / analytics events: `noun.verb` past tense — `task.created`,
  `agent.paused`, `pr.opened`. Same shape regardless of the layer that
  emits them.

### Environment variables

- `SCREAMING_SNAKE_CASE`, prefix with the system that owns them when there
  is risk of collision: `ANTHROPIC_API_KEY`, `GITHUB_APP_ID`,
  `AGENTBOARD_DATABASE_URL`. See `.env.example` as the source of truth.

---

## 3. User-facing copy

### Error messages

The 4-part formula:

> **What happened. (Why, if useful.) What to do next. (Identifier, if it
> helps support.)**

| Bad | Better |
|---|---|
| `"Error 500"` | `"Couldn't save the task — database is locked. Retry in a moment."` |
| `"Failed to create session"` | `"Couldn't sign you in. Try again, or contact an admin if it keeps happening."` |
| `"No GitHub connection"` | `"GitHub isn't connected. Open Settings → GitHub to link an account."` |
| `"Subject and content are required."` | ✅ already specific — keep it. |
| `"Task deletion is not implemented yet. Drag to 'Done' to archive."` | ✅ honest about state + offers an alternative. |

Rules:

- Address the **user**, not the developer. Avoid "the function returned
  null" — that belongs in logs.
- Don't expose stack traces or SQL fragments in the UI. Log them, surface
  a friendly message + a copyable error id.
- Don't blame the user. "Password must be at least 8 characters" beats
  "Your password is invalid".
- Punctuation: full sentences end with a period. Single-line form
  validation messages can drop the period — but be consistent within a
  surface.

### Buttons

- **Verb-first**, sentence case: "Create task", "Open preview", "Sign in".
- Avoid "OK" / "Submit" / "Click here" — they don't say what happens.
- Destructive buttons name the consequence: "Delete user", not "Confirm".

### Confirmations & dialogs

State the consequence clearly:

> **Delete this agent?**
> Their persona, inbox, and worktree will be removed. Open tasks will be
> unassigned. This cannot be undone.
>
> [ Cancel ]   [ Delete agent ]

The destructive button repeats the verb. Cancel is left, primary action is
right.

### Empty states

Three lines: **what this surface shows**, **why it's empty**, **what to do**.

> No previews running.
> Previews appear here when an agent ships a task with `launch_preview`.
> Try assigning a UI task to lucas-frontend.

### Toasts / inline status

- Success: past tense, single clause — "Task moved to In progress."
- Error: see error rules above. If you must be terse, keep the *what to do*
  half: "Couldn't save — retry."

---

## 4. Internationalization

### Current posture (April 2026)

**English-only**, by deliberate decision recorded in
[ADR 0001 — i18n: stay English-only](adr/0001-i18n-defer.md) (2026-04-25).
No locale files, no `react-i18next` install, no string extraction this
sprint. Read as policy, not as default — the decision flips only when one
of the triggers in the ADR fires (paying customer asks for a non-EN UI,
public multilingual launch, non-EN contributor on the product surface,
multilingual marketing/docs ship). Until then we keep the i18n-friendly
authoring rules below so the future flip stays cheap.

### Forward-looking rules (apply now anyway)

Even before i18n is wired up, write code that won't bite us later:

- **Never concatenate translatable phrases.** `"Hello, " + name` is fine
  as a one-off, but the moment a phrase has more than one variable, use
  template literals with named placeholders so future keys map cleanly.
- **Don't bake plurals into branches.** When pluralisation matters, keep
  the full sentence in one place: `count === 1 ? "1 task" : \`${count} tasks\``
  rather than splitting `${count} task` and tacking on `"s"`.
- **No hardcoded dates / numbers.** Use `Intl.DateTimeFormat` and
  `Intl.NumberFormat` even with `'en-US'` — swapping locales later is then
  a one-line change.
- **Direction-agnostic CSS.** Prefer `padding-inline-start` over
  `padding-left`, `margin-inline-end` over `margin-right`. Tailwind has
  `ps-*` / `pe-*` utilities — use them on text-bearing elements.

### When we flip

The first locale beyond English **will be pt-BR**, alongside `en` as the
canonical source. The library, key format, source path, and extraction
pipeline are all pre-decided in [ADR 0001](adr/0001-i18n-defer.md) so we
skip the bikeshed when the trigger arrives:

- **Library:** `react-i18next`.
- **Keys:** flat dotted, `surface.subject.thing` (e.g. `board.empty.title`,
  `errors.session.create`).
- **Source:** `apps/web/src/locales/<lang>.json`, `en` canonical, `pt-BR`
  alongside.
- **Pipeline:** build-time extraction (`i18next-parser` or equivalent).
  Keys ship in the bundle; no runtime fetch.
- **Enforcement:** ESLint rule banning raw string children in JSX inside
  `apps/web/src/**`, with an allowlist for code/dev surfaces (logs, debug
  panels). See ADR 0001 for the exact policy.

Other things to confirm at flip time, not pre-decided:

- Date / number formatting always goes through the locale (already a rule
  above — `Intl.*`).
- RTL behavior — quick CSS audit before adding `ar` / `he`.
- Lazy-load locale chunks; don't ship every locale on first paint.

Until a trigger fires, this section is the playbook, not a rule.

---

## 5. Commit messages

Conventional Commits, lower-case subject, imperative mood, ≤ 70 chars:

```
docs: add style guide
feat(board): drag-and-drop persistence on column change
fix(orchestrator): retry GitHub clone on transient 5xx
chore(deps): bump @anthropic-ai/sdk to 0.45.0
```

Types we use: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`,
`build`, `ci`. Scope is the package or surface (`board`, `orchestrator`,
`mcp`, `web`). Body lines wrap at ~72 chars; reference the task id at the
bottom when it advances one:

```
Refs: task-3cd3a6f8
```

---

## 6. Pull request reviews — language checklist

When you review a PR, check these in order before merging:

- [ ] Variable / function names match the rules in §2.
- [ ] User-facing strings follow §3 (error format, button verbs, no "Error 500").
- [ ] No hardcoded strings the project's i18n posture forbids (§4).
- [ ] Commit messages follow §5.
- [ ] README / docs updated if behavior changed.
- [ ] No leaked debug copy: `console.log("here")`, `// TODO fix this lol`,
      placeholder text like "Lorem ipsum" or "TBD".

leo-langs reviews land as `send_message` of type `review` with bullet-form
comments shaped like:

> `apps/web/src/pages/Board.tsx:142` — rename `handleThing` to
> `handleTaskDrop`. "thing" leaks into telemetry events.

---

## 7. Documentation tone

- README opens with **what it is** in one sentence, then **why it exists**.
- ARCHITECTURE.md is for design rationale, not API reference.
- Code comments explain **why**, not **what** — the function name and
  signature already say *what*.
- ADRs (`record_decision`) capture decisions that future agents will be
  tempted to re-debate. Title is one sentence, body has *Decision*,
  *Alternatives*, *Reasoning*.
- Persona files (`agents/<role>.md`) follow the existing structure:
  Identity, Responsibilities, Tools, How you work, Teammates, Golden rules.
  Don't reorder sections — the seeder reads positionally in some places.

---

## 8. Things to avoid

- Em-dashes inside identifiers (Unicode `—` looks like a hyphen, breaks search).
- Ambiguous abbreviations (`mgr`, `ctx`, `tmp`, `cfg`). Spell them out.
- Marketing words in code (`awesome`, `magic`, `simple`). Code doesn't
  brag.
- Negative booleans (`isNotReady`, `noAccess`). Flip them.
- Mixing tense in user-facing copy. "Saving…" → "Saved." not "Save
  complete".
- Strings that say `[object Object]` — wrap `String(err)` calls in a
  helper that handles `Error`, `string`, and unknown.

---

## 9. Where this guide lives

- This file: `docs/style-guide.md`.
- Updates land as PRs reviewed by **leo-langs** (with **carl-cto** when a
  rule has architectural weight, e.g. picking the i18n library).
- If a rule here gets in your way for a real reason, propose a change to
  the guide *before* breaking it in product code.
