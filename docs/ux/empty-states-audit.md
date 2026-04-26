# Empty States Audit

**Author:** uma-uiux
**Task:** 6a6152e7-1bbd-42e9-ab5e-1a05437f8868
**Status:** audit only — implementation is a follow-up
**Scope:** 12 top-level routes in the web app

> An empty state is the state a user lands in *before* the system does
> the thing it's for. It is the most important state to design well —
> a populated screen explains itself; an empty one has to.

---

## 1. Methodology

For each of the 12 routes, I read the page component, located the
"if data is empty, render this" branch, and copied the literal title /
body / CTA copy. Findings below quote source exactly. No screens were
changed in this audit — that's a follow-up card.

Each page is graded on three axes:
- **Title** — present? appropriately scoped?
- **Body** — does it explain *what triggers content*?
- **CTA** — present and useful when an action is possible?

Plus a fourth, cross-cutting axis I'll cover in §3:
- **Voice** — does it sound like the rest of the app?

---

## 2. Top findings (read this if nothing else)

1. **`/settings` has no visual empty state at all.** It renders form
   fields and inline status text regardless of whether anything is
   configured. A first-time user opening Settings sees a wall of
   options with no narrative. **Highest-priority gap.**

2. **Voice is inconsistent.** Across 12 pages I count: "Nothing here",
   "Nothing here", "Nothing matches this filter.", "No accounts
   visible.", "No previews", "No commits match.", "No events match",
   "No usage yet.", "All idle.", "No projects connected", "No agents
   match this filter". Mixed terminal punctuation (period vs none),
   mixed formality, mixed length. Small individually, loud in
   aggregate.

3. **Only 2 of 12 pages offer a CTA from the empty state**
   (`/projects`: "+ Connect your first repo"; `/agents`: implicit
   "Hire one above"). Several others *should* — `/orgs` is a dead-end
   without a connect-GitHub button; `/previews` tells the user how
   agents publish previews but offers no way to act on it.

4. **Dev-tool jargon leaks into user-facing copy.** `/agents` empty
   says: *"run `pnpm db:seed` to create the starter team."* That's
   a developer instruction in a UI surface. Either the seed is
   automated and this copy is obsolete, or the UI should expose a
   button.

5. **Filter-empty vs source-empty is conflated** on most pages.
   "No commits match" reads the same whether the user has applied a
   filter or whether no commits exist at all. These are different
   states and want different copy.

---

## 3. Voice & tone — proposed unified rules

Adopt a four-rule house style for empty-state copy:

1. **Title is a noun-phrase, no period.** "No projects yet" not
   "No projects yet."
2. **Body is one sentence, ends with a period.** Explains *what
   produces content* in plain language. No code identifiers in user
   copy unless we mean it (e.g., shell commands belong in docs, not
   UI).
3. **CTA is verb-first, ≤4 words.** "Connect a repo" not
   "+ Connect your first repo".
4. **Distinguish filter-empty from source-empty.** When a filter is
   applied: "No X match this filter — clear filters." When the source
   is empty: "No X yet — <how to create one>."

This applies to all empty states going forward. The per-page table
below proposes specific copy in this style.

> **Copy sign-off:** all proposed strings in §4 are uma-uiux drafts.
> Final copy requires `leo-langs` review before any implementation PR
> ships. Audit-stage approval (this doc) is structural; copy-stage
> approval is its own gate.

---

## 4. Per-page audit

> File paths are relative to the repo root.

### 4.1 `/dashboard` — composite (8 cards)

**File:** `apps/web/src/pages/Dashboard.tsx` (lines 72–74, 98–99,
169, 194–195, …)
**Data:** working agents, pending approvals, running previews,
recent activity (and 4 more)
**Current copy (verbatim):**
- "All idle. Try Chat (⌘K) to kick something off."
- "Nothing waiting on you."
- "No live containers."
- "No events yet."

**Issue:** voices vary card-to-card ("All idle" vs "Nothing waiting"
vs "No live containers" — three different tones in one viewport).
The Chat (⌘K) hint is *good* — concrete, actionable — but only one
card has it.

**Proposed copy:**
| Card               | Title             | Body                                                   | CTA           |
| ------------------ | ----------------- | ------------------------------------------------------ | ------------- |
| Working agents     | No agents working | Agents become "working" when assigned a task.          | Open Chat ⌘K  |
| Pending approvals  | Nothing to approve| Agents will queue requests here when they need a call. | —             |
| Running previews   | No previews live  | Containers appear here once an agent ships a preview.  | —             |
| Recent activity    | Nothing yet       | Tool calls, messages, and commits land here in real time. | —          |

### 4.2 `/live`

**File:** `apps/web/src/pages/Live.tsx` (lines 142–145, 248–250)
**Current:** "Nothing matches this filter." (filter empty);
per-swimlane "idle" (label, not empty state)

**Issue:** filter-empty is fine; the per-swimlane "idle" is a *status*
not an empty state and should stay.

**Proposed:**
- Filter-empty: **"No agents match this filter"** body **"Clear the
  filter to see everyone."** CTA **"Clear filters"**.
- Per-swimlane: keep current "idle" status label.

### 4.3 `/board`

**File:** `apps/web/src/components/KanbanColumn.tsx` (lines 45–47)
**Current:** Per-column "Nothing here"

**Issue:** terse, but per-column empty is the right pattern (avoids
making the whole board look broken when one column is empty). Could
add a column-aware hint without losing brevity.

**Proposed:**
- **Backlog/Todo column:** title "Nothing here yet"; subtle hint
  "Drag a card in or chat ⌘K"; no CTA.
- **In-progress / Review / Done columns:** title "Nothing here yet";
  no body; no CTA. (These columns fill themselves; explaining is
  noise.)

### 4.4 `/agents`

**File:** `apps/web/src/pages/Agents.tsx` (lines 88–96)
**Current title:** "No agents match this filter"
**Current body:** "Hire one above, or run `pnpm db:seed` to create the
starter team."

**Issue:** mixes filter-empty title with source-empty body, and leaks
`pnpm db:seed` (dev jargon) into prod UI.

**Proposed (split into two states):**
- **Filter-empty:** title "No agents match this filter"; body "Clear
  the filter to see everyone."; CTA "Clear filters".
- **Source-empty:** title "No agents yet"; body "Hire your first
  agent to start delegating work."; CTA "Hire an agent".
- Drop the `pnpm db:seed` reference — if seeding is required for a
  fresh install, expose a "Load starter team" button or move the
  instruction to setup docs.

### 4.5 `/projects`

**File:** `apps/web/src/pages/Projects.tsx` (lines 106–122)
**Current title:** "No projects connected"
**Current body:** "Connect a GitHub repository so agents can clone it,
create task branches, commit, and open pull requests instead of
working in throwaway worktrees."
**Current CTA:** "+ Connect your first repo"

**Issue:** title is good. Body is too long (5 verbs, 1 sentence).
CTA is verb-first ✅ but bloated by "+ ... your first repo".

**Proposed:**
- Title: "No projects yet"
- Body: "Connect a GitHub repo so agents can branch, commit, and open
  PRs."
- CTA: "Connect a repo"

### 4.6 `/orgs`

**File:** `apps/web/src/pages/Orgs.tsx` (lines 90–96)
**Current:** "No accounts visible." / "Connect GitHub first."
+ token-scope warning

**Issue:** dead-end. The user is told their token doesn't see orgs but
isn't given a way to fix it. The token-scope detail (GitHub App vs
OAuth) belongs in a tooltip, not the primary copy.

**Proposed:**
- Pre-connect title: "No GitHub account connected"
- Pre-connect body: "Connect GitHub to see your orgs and repos."
- Pre-connect CTA: "Connect GitHub"
- Post-connect-but-empty: title "No orgs visible"; body "Your token's
  scope may be too narrow."; CTA "Switch to GitHub App" (with a
  "Why?" tooltip linking to docs).

### 4.7 `/previews`

**File:** `apps/web/src/pages/Previews.tsx` (lines 381–391, 394–402)
**Current sidebar:** "No previews"
**Current sidebar body:** "Agents publish previews via `launch_preview`
after they ship a Dockerfile or compose.yml in their worktree."
**Current right pane:** icon + "Select a preview to view details"

**Issue:** sidebar copy is dense and tool-name (`launch_preview`)
leaks. Right pane "Select a preview" copy is the *resting* state
between two clicks, not really an empty state — keep it.

**Proposed sidebar:**
- Title: "No previews live"
- Body: "Previews appear here when an agent ships a Docker container."
- CTA: none (this is a passive surface; the work happens in agent
  worktrees).

### 4.8 `/commits`

**File:** `apps/web/src/pages/Commits.tsx` (lines 131–136)
**Current:** "No commits match." / "When agents push work, it shows
up here automatically."

**Issue:** filter-empty and source-empty conflated. Title is fine;
body assumes source is empty.

**Proposed (split):**
- Filter-empty: title "No commits match this filter"; body "Clear
  the filter to see all commits."; CTA "Clear filters".
- Source-empty: title "No commits yet"; body "Commits appear here
  when agents push work to a connected repo."; CTA none.

### 4.9 `/timeline`

**File:** `apps/web/src/pages/Timeline.tsx` (lines 138–143)
**Current:** "No events match" / "Loosen the filters or wait — every
tool call, message, commit, and approval lands here in real time."

**Issue:** body is good — it tells the user *both* paths forward
(loosen filters or wait) and explains what populates the page.
Slight rewrite for parallelism with the rest of the app.

**Proposed:**
- Title: "No events match this filter"
- Body: "Loosen the filter or wait — agent activity lands here in
  real time."
- CTA: "Clear filters"

### 4.10 `/usage`

**File:** `apps/web/src/pages/Usage.tsx` (lines 104–105, 136–137)
**Current:** "No usage yet." / "No usage recorded yet."

**Issue:** two empty states with near-identical copy in different
sub-cards. Combine voice; explain what triggers content.

**Proposed:**
- Per-day card: title "No usage in this range"; body "Usage tallies
  appear once an agent makes its first model call.";
- Per-agent card: same title + body, scoped to the selected agent.
- CTA: none (passive metric).

### 4.11 `/approvals`

**File:** `apps/web/src/pages/Approvals.tsx` (lines 88–95)
**Current:** title "Nothing here"; body context-aware
("No agent is waiting on your call..." / "No records match this
filter.")

**Issue:** title is too generic for an approvals page — risks reading
as "nothing exists" when the meaning is "nothing pending". Body is
good and already context-aware ✅.

**Proposed:**
- Pending tab: title "All clear"; body "No agent is waiting on your
  call right now."
- Approved/Rejected/All tabs: title "No records match this filter";
  body "Clear the filter to see history."; CTA "Clear filters".

### 4.12 `/settings`

**File:** `apps/web/src/pages/Settings.tsx`
**Current:** ⚠️ **No empty state.** Form fields render regardless of
configuration; status is communicated only inline (e.g., "Connected
as @user" vs "Not connected").

**Issue:** the highest-leverage gap on this audit. A first-time user
opens Settings and sees a wall of options with no orientation about
what to do first.

**Proposed:**
- Add a top-of-page **Setup Checklist** card that appears only when
  *any* required integration is missing. Items:
  - ☐ Connect GitHub
  - ☐ Configure model API key
  - ☐ Add a project
  - ☐ Verify notifications
- Each item links to its respective section. Card disappears once
  all items are checked.
- Empty state for the card (when checklist would be empty): hide the
  card entirely. (Don't celebrate emptiness — just remove the
  scaffold.)

This is the only page where the "audit" turns into a layout
recommendation rather than a copy recommendation. Flagging
explicitly so the impl follow-up cards can scope it correctly.

---

## 5. Implementation handoff notes

When this audit becomes follow-up cards (one per page or batched by
component), three things to keep in mind:

1. **Voice rules in §3 are non-negotiable** for the polish wave. Ship
   them as a single PR rather than per-page so the diff reviews easily.
2. **Filter-empty vs source-empty needs a small predicate** in each
   page — usually `filtersActive && rows.length === 0` vs
   `rows.length === 0`. Lucas will know the right shape.
3. **`/settings` is its own card** — it's a layout change, not a
   string change. Don't bundle it with the copy-only PR.

Future pages should ship with their empty states designed at the same
time as their populated states. I'll mirror these rules into the
component spec when we open one for the kanban card polish (parent
task 7c9bd1ad).
