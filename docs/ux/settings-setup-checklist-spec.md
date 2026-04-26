# Design Spec — `/settings` Setup Checklist

**Status:** approved (carl-cto + leo-langs, PR #8) — review notes folded in
**Owner:** uma-uiux → lucas-frontend (impl follow-up card)
**Task:** ddac153f-e0b8-4972-a1fa-04c8511d6e2f
**Source gap:** [Empty-state audit §1, §4.12](./empty-states-audit.md)
**Related flow:** [`design/flows/settings-setup-checklist.md`](../../design/flows/settings-setup-checklist.md)
**Mockup:** [`design/settings-setup-checklist.html`](../../design/settings-setup-checklist.html) (open in browser)

> A first-time user lands on `/settings` today and sees a wall of
> options with no anchor. This card is the anchor. It exists only
> while there is something to set up, and removes itself the moment
> the user has finished. It does not become a permanent fixture,
> a dashboard widget, or a thing to dismiss.

---

## 1. Information architecture

The checklist sits at the **top of `/settings`**, full-width within the
existing settings container, above all settings sections. Three layouts
were considered:

| Option            | Verdict   | Reasoning                                            |
| ----------------- | --------- | ---------------------------------------------------- |
| **Top-of-page**   | ✅ Chosen | Unmissable on first paint; auto-removes when done. The card *is* the orientation; placing it anywhere else delays the goal it serves. |
| Sidebar           | ✗         | Easy to ignore on first load; reads as "secondary nav" not "do this first." Also creates desktop-only behavior since `/settings` is single-column on mobile. |
| Collapsed accordion | ✗       | A user who needs orientation cannot be expected to expand a header to find it. Self-defeating. |

**Once the user has completed all four items the card removes itself
from the DOM** (see §3 state transitions). It does **not** become a
"✓ Setup complete" tombstone. The audit's voice rule §3 says don't
celebrate emptiness; this honors it.

The four items, in this order, intentionally:

1. **Connect GitHub** (highest blocker — agents can't do most work without a repo).
2. **Configure model API key** (second blocker — agents can't think without a model).
3. **Add a project** (consequence of GitHub being connected; users may have multiple).
4. **Confirm notifications** (lowest blocker — defaults work; this is "you've seen it").

The order is fixed. We're not letting the user reorder; the dependency
chain (GitHub → API key → project → notifications) is real, even if (3)
and (4) are technically independent.

---

## 2. Layout

### Card placement

```
┌──── /settings page (max-width 980px, centered) ─────┐
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  Get set up                              4/4  │  │  ← the card
│  │  4 steps to a working agent                   │  │
│  │                                               │  │
│  │  ◯ Connect GitHub                  [Set up →] │  │
│  │     Agents need this to clone repos           │  │
│  │     and open pull requests.                   │  │
│  │                                               │  │
│  │  ◯ Add a model API key             [Set up →] │  │
│  │     Agents need a model provider —            │  │
│  │     bring your OpenAI or Anthropic key.       │  │
│  │                                               │  │
│  │  ◯ Add a project                   [Set up →] │  │
│  │     Connect a GitHub repo for agents          │  │
│  │     to work in.                               │  │
│  │                                               │  │
│  │  ◯ Confirm notifications           [Set up →] │  │
│  │     Pick how we ping you when an              │  │
│  │     agent needs a call — defaults are fine.   │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ── Settings sections begin here ───────────────    │
│                                                     │
│  ## Integrations                                    │
│  …existing settings sections, unchanged…            │
└─────────────────────────────────────────────────────┘
```

### Spacing

All values are 8-point rhythm (matches the existing design system
established in `hello-world-spec.md`):

| Element                    | Spacing                                   |
| -------------------------- | ----------------------------------------- |
| Card → first settings section | 32px below                              |
| Card outer padding         | 24px on tablet+ (`≥734px`); 16px on mobile |
| Card border-radius         | 12px                                      |
| Header → first item        | 16px                                      |
| Item ↔ item                | 16px (vertical gap between items)         |
| Indicator → title          | 12px                                      |
| Title → body               | 4px                                       |
| Item row → CTA             | 16px (horizontal)                         |
| CTA inner padding          | 8px vertical, 16px horizontal             |

### Mobile (< 734px)

- Card padding drops to 16px.
- CTA stacks **below** body (full-width, content-padding aligned with
  body text), not to the right. Two reasons: (a) right-aligned CTA on
  a narrow column crowds the body to a 2-3 word column; (b) full-width
  pill is the established mobile convention for primary actions in the
  rest of the app.
- The card itself remains full-width within the page padding (22px
  page padding inherited from existing layout).
- **CTA label drops the trailing arrow on mobile.** Desktop CTA reads
  "Set up →"; mobile CTA reads "Set up". Reason: on desktop the arrow
  is a "tap-into-section" affordance for a row that's also a button;
  on mobile the full-width pill *is* the affordance, so the arrow
  becomes redundant ornamentation. A small detail, but worth
  specifying so the impl PR doesn't conform them in either direction.
- Single layout breakpoint: **734px**, matching the hello-world spec.

---

## 3. Per-item states

Three states per item: `not_started`, `in_progress`, `done`. Each item
also has a `loading` shimmer for the brief moment the page is fetching
state from the server (covered in §6 Loading & Empty).

### 3.1 `not_started`

- **Indicator:** empty circle, 20px diameter, 1.5px stroke,
  `border/hairline` color (`rgba(0,0,0,0.24)` — slightly stronger than
  the page hairline so it reads as a control, not a divider).
- **Title:** 15px, weight 500, `text/primary` (`#1D1D1F`),
  letter-spacing `-0.01em`.
- **Body:** 13px, weight 400, `text/secondary` (`#86868B`),
  line-height 1.4. Max ~14 words. Tells the user *why* this step
  matters in plain English.
- **CTA:** "Set up →" — 13px, weight 500, `accent/blue`. Ghost button
  (no fill), 8px×16px padding, 8px border-radius. Hover tints
  background to `accent/blue` at 8% alpha.

**Microcopy per item — `not_started`:**

| Item            | Title              | Body                                                   |
| --------------- | ------------------ | ------------------------------------------------------ |
| 1. GitHub       | Connect GitHub     | Agents need this to clone repos and open pull requests.|
| 2. Model key    | Add a model API key| Agents need a model provider — bring your OpenAI or Anthropic key. |
| 3. Project      | Add a project      | Connect a GitHub repo for agents to work in.           |
| 4. Notifications| Confirm notifications| Pick how we ping you when an agent needs a call — defaults are fine. |

Copy reviewed by `leo-langs` on PR #8 (2026-04-26):
- Item 2 body rewritten to keep the door open for additional providers
  (Google, Mistral, local Ollama). Same length, less brittle than naming
  two specific vendors as a permanent product fact.
- Item 3 body tightened to make the "project = GitHub repo" equivalence
  explicit on first encounter (the audit's §4.5 already established it,
  but a first-time user has no prior context).
- Item 4 title flipped from "Verify" to "Confirm" so title and body
  agree on the mechanic: the user is acknowledging defaults, not
  testing an existing config. Pairs with carl-cto's §7 answer (we add
  a `notifications_acknowledged_at` flag set on explicit Save) — see §7.

### 3.2 `in_progress`

- **Indicator:** half-filled circle (◐) in `accent/blue`, OR a 14px
  spinner when state is "actively loading from server" (e.g.,
  GitHub App installation pending on the GitHub side).
- **Title & body:** unchanged from `not_started`.
- **CTA:** "Continue →" instead of "Set up →".
- **Note:** for v1, only step 1 (GitHub) is likely to ever be in
  `in_progress` — the others either complete instantly or not at all.
  Still, all four items support the state for symmetry.

### 3.3 `done`

- **Indicator:** filled circle (●), 20px diameter, `accent/blue` fill,
  white checkmark stroke (1.5px). 200ms `cubic-bezier(0.2, 0.6, 0.2, 1)`
  ease when transitioning from `not_started` → `done`.
- **Title:** color shifts to `text/secondary` (`#86868B`). **Do not
  strikethrough.** Strikethrough reads as "deleted" or "skipped"; we
  want "complete and de-emphasized." Title remains 15px weight 500.
- **Body:** collapses to `height: 0; opacity: 0` over 200ms — saving
  vertical space, since a done item only needs its title.
- **CTA:** replaces "Set up →" with "Edit" — 13px weight 400,
  `text/secondary`, no border, hover → `text/primary`. The user can
  still revise the step (e.g., swap GitHub orgs).

### 3.4 Hover & focus

- **Hover on row** (any state): row background tints to `bg/subtle`
  (`#F5F5F7`) over 150ms ease.
- **Focus** (keyboard tab to CTA): brand-blue 3px outline at 40% alpha
  with 2px offset, matching the established focus ring from
  `hello-world-spec.md` §5.3.
- **Pointer cursor** appears on the entire row, not only the CTA —
  the whole row is a target. Click anywhere on the row triggers the
  CTA action. This is established Apple-style "card is a button"
  behavior.

---

## 4. Card-level states

### 4.1 Header

```
Get set up                                 1/4
4 steps to a working agent
```

- **Title:** 17px, weight 600, `text/primary`, letter-spacing
  `-0.01em`. "Get set up" is the only branding the card needs;
  resist "Welcome to AgentBoard!" tone (we're not asking for
  applause, we're showing a ladder).
- **Subtitle:** 13px, `text/secondary`, line-height 1.4.
- **Counter:** 13px, weight 500, `text/secondary`, right-aligned.
  Updates live as items complete: `0/4` → `1/4` → … → `4/4`.

### 4.2 The "completing" affirmation (1.5s, transient)

When the user checks the **last** item the card replaces its content
with a single affirmation row:

```
✓ All set
You're ready. Settings are right below.
```

- Lasts **1500ms**, then unmounts.
- Indicator: filled circle, `accent/blue`, white check, 24px.
- Title: 17px, weight 600, `text/primary`.
- Subtitle: 13px, `text/secondary`. Tells the user where things go
  next so the page reflow doesn't disorient them.
- Reduced-motion: skip the 1500ms hold; unmount immediately and let
  the page reflow without the affirmation. (Long static affirmations
  read as a popup the user must wait through.)

### 4.3 Card hides forever once `4/4`

After the affirmation unmounts the card is **not** re-rendered on
subsequent visits. There is no preference, no toggle, no "Show
again" link. If the user later disconnects GitHub or removes their
last project, the card **does** reappear (we re-derive its visibility
from current state every render — no `hide_setup_checklist_at`
column).

This is the most opinionated decision in the spec; see §7 Open
Questions for one carl-cto check on the data model.

---

## 5. Visual treatment

### 5.1 Container

- **Background:** `canvas` (`#FFFFFF`).
- **Border:** 1px solid `border/hairline` (`rgba(0,0,0,0.08)`).
- **Border-radius:** 12px.
- **Shadow:** none. This is consistent with the team's flat-color
  posture (see hello-world-spec §8 "What NOT to do").

### 5.2 Tokens reused

All from `hello-world-spec.md`:

- Color: `canvas`, `subtle`, `ink` (= `text/primary`),
  `muted` (= `text/secondary`), `brand` (= `accent/blue`),
  `brand-hover`, `brand-active`.
- Font: SF system stack.
- Letter-spacing: `tight2 (-0.01em)` for UI text, `display (-0.015em)`
  for the card header is **not** used here — the header is small, no
  display typography needed.
- Spacing: 8-point grid.
- Breakpoint: single `tablet: 734px`.
- Focus ring: 3px solid `rgba(0,113,227,0.4)` with 2px offset.

**No new tokens required.** If lucas-frontend finds himself wanting
a token that isn't already in `tailwind.config`, ping me — that's a
signal we missed something in the system.

### 5.3 Indicator details

The state indicator is the most repeated visual on the card; it
deserves precision.

| State        | Shape         | Stroke / Fill                                 | Icon      |
| ------------ | ------------- | --------------------------------------------- | --------- |
| not_started  | empty circle  | 1.5px stroke, `rgba(0,0,0,0.24)`              | none      |
| in_progress  | half-filled   | 1.5px stroke + 50% radial fill, `accent/blue` | none      |
| in_progress (loading) | spinner | 1.5px stroke, `accent/blue`, 1s linear   | none      |
| done         | filled        | `accent/blue` fill                            | white ✓, 1.5px stroke |

All indicators are **20px**. Aligned vertically with the **first line
of the title** (not centered to the row), so the eye gets a tight
horizontal sweep across `[indicator] [title]`.

### 5.4 Motion

- All transitions: **200ms `cubic-bezier(0.2, 0.6, 0.2, 1)`**
  (matches Apple's standard ease-out).
- Background tints on hover: 150ms.
- Section-anchor highlight on scroll: 1500ms outline, then 250ms fade.
- **Respect `prefers-reduced-motion`:** drop all transitions to 0ms,
  unmount the affirmation immediately (no 1.5s hold).

---

## 6. Loading & empty (cross-cutting states)

Every UI surface needs these. Per the empty-state audit voice rules
§3, copy is title-no-period, body-one-sentence-period, CTA-verb-first.

### 6.1 Loading (page just opened, fetching state)

Render the card scaffold (header, item rows, indicators) but with:

- **Indicators:** 20px gray circle, `bg/subtle` fill, no stroke.
  Shimmer animation 1.2s linear-infinite alternating
  `bg/subtle` ↔ `rgba(0,0,0,0.06)`.
- **Titles:** 60% width gray bar (`bg/subtle`), 12px tall,
  border-radius 4px, same shimmer.
- **Bodies:** two stacked 90% / 60% width bars, same shimmer.
- **CTAs:** hidden during loading.
- **Counter (top right):** "—/4" placeholder, no shimmer.

Reduced-motion drops shimmer to a static bar.

### 6.2 Empty (none of the four items make sense yet)

This state should **not occur in v1** — the four items are universal
to every workspace. If a future variant introduces conditional items
(e.g., "Add a billing method" only for paid tiers), we revisit. For
now, do not spec an empty state for this card — its empty state *is*
not rendering at all (= all-done = unmount). Document that in code
comments.

### 6.3 Error (state fetch fails)

Render the card with a single row replacing the four items:

- **Title:** "Couldn't load setup status"
- **Body:** "Try again, or check your connection."
- **CTA:** "Retry"

(Body verb pairs with CTA verb for consistency — both are "retry"
shaped, not the body-says-refresh / CTA-says-retry mismatch flagged
on PR #8 review.)

This is the conventional error pattern — a soft fallback rather than
a banner. Don't blow up the whole page; the rest of `/settings` is
still useful even if we can't render the checklist.

### 6.4 Data flow (per carl-cto, PR #8 review)

The checklist's four predicates are owned by the **backend**, not
re-derived on the client per-row. Single endpoint:

```
GET /api/setup/status
→ 200 { github: bool, modelKey: bool, project: bool, notifications: bool }
```

- Backend owns the truth predicates (env-presence for `modelKey` in v1,
  table-existence for `project`, install-status for `github`,
  `notifications_acknowledged_at IS NOT NULL` for `notifications`).
- Frontend renders the four booleans into the four item states. No
  client-side branching across individual settings rows.
- Loading state (§6.1) maps to the request being in flight.
- Error state (§6.3) maps to a non-2xx response.
- Re-fetched on `/settings` mount (and after any in-section Save that
  could flip a bit — `react-query` invalidation on `setup-status` key).

Why one endpoint instead of four `/api/setup/*` rows: the predicate
logic stays unforkable between client and server, the round-trip
budget is one not four, and the boolean shape never needs to change
even if the per-bit data source does (carl's v2 per-user-keys note).

---

## 7. carl-cto review answers (PR #8, 2026-04-26)

All three open questions answered. Verdict: **APPROVED for merge** —
no architectural changes needed beyond the §6.4 data-flow note above.
Decisions captured here for future-self.

### 7.1 Notifications "verified" — add an ack flag

Add a small per-user flag. Treating "default-on = done" lies to the
user about a step they never took, and the audit voice rule §3
("Honest") forbids that.

Concrete shape:

```sql
ALTER TABLE users
  ADD COLUMN notifications_acknowledged_at TIMESTAMPTZ NULL;
```

- Set on explicit user action: clicking **Save** (or equivalent
  commit) in the notifications section.
- `done` predicate: `notifications_acknowledged_at IS NOT NULL`.
- One column, no index needed (read as a scalar on page render).
- v1 is one-way: once acknowledged, stays acknowledged. v2 may
  null-it-out on settings change ("you changed channels, please
  re-verify") — flagged for future, not implemented now.

Bruno-backend picks up the migration + Save handler as a small
follow-up card alongside lucas-frontend's impl. Alice routes.

### 7.2 Model API key check cost — trivially cheap, today and later

Today: there is no per-user encrypted key store. `ANTHROPIC_API_KEY`
lives in `.env` (`apps/orchestrator/src/config.ts:21`), single
instance for the whole orchestrator. There's nothing to decrypt
because there's nothing per-user to encrypt.

**v1 (this card):** the `modelKey` predicate is a boolean derived
from the orchestrator's process env at request time. Surfaced via
the `GET /api/setup/status` endpoint (§6.4). Response includes
only `{ modelKey: true | false }` — never the key value itself.

**v2 (future, separate ADR):** when per-user provider keys land,
"has any key" stays cheap — single indexed `EXISTS` against the
keys table. We don't decrypt to answer existence; decryption only
happens at model-call time. The checklist's `modelKey` boolean
keeps the same shape; the source of truth swaps under it. **No
checklist redesign needed for v2.**

### 7.3 `/settings` route shape — single page with anchors

`/settings` is one page. Section anchors: `#integrations`,
`#api-keys`, `#projects`, `#notifications`. Reasons:

1. The smooth-scroll-and-highlight on CTA click only works on a
   single document. Split routes turn it into a full navigation
   and break the "stay-in-place orientation" mental model.
2. Route splits cost a load per step. Anchors are free.
3. The spec's whole story ("the settings page they were always
   going to see is now there, exactly where it always was") is
   built on a single page. Don't undermine it.

Revisit only if `/settings` outgrows ~3 screens of options. Today
it's nowhere close. Lucas wires the four CTAs as `href="/settings#…"`
deep-links plus a smooth-scroll handler.

---

## 8. Accessibility

- **Indicator contrast.** Filled `done` circle uses `accent/blue` on
  white = 4.94:1 — passes AA for non-text UI components ✅.
  Empty-circle stroke `rgba(0,0,0,0.24)` is decorative only (the
  state is also conveyed in text via the `done`-class title-color
  shift), so it doesn't need to meet text contrast.
- **Screen-reader semantics.**
  - Card root: `<section aria-labelledby="setup-checklist-heading">`.
  - Header: `<h2 id="setup-checklist-heading">Get set up</h2>`.
  - Each item: `<button>` (yes, the row IS the button — single-tab-stop
    target, single click target). Inside: `<span aria-hidden="true">`
    for the icon, then visible text title + body, then `<span
    class="sr-only">step 1 of 4, not started</span>`.
  - **Do not put an `aria-label` on the row `<button>`.** An aria-label
    on a button overrides the entire visible text — SR users would
    lose the body sentence (the *why* of each step) and the CTA verb.
    Visible title + body + sr-only step counter is the right pattern;
    let the SR read the same content a sighted user gets.
  - State changes announce via `aria-live="polite"` region containing
    text like "Connect GitHub: completed".
  - **State words are fixed:** `completed` / `in progress` / `not started`.
    Used in both the sr-only step counter and the aria-live updates.
    Don't drift to `connected` for item 1 — "completed" reads cleanly
    for any of the four items, and a user who doesn't know GitHub-specific
    verbs isn't slowed down by a state word that turned domain-specific.
- **Keyboard.** Tab moves through items in order. Enter or Space
  triggers the CTA. Escape on a focused row does nothing (the row
  is not modal).
- **Reduced motion.** All transitions become 0ms. Affirmation
  unmounts immediately. Shimmer becomes a static bar.

---

## 9. Out of scope

- **Implementation.** This spec is design only; lucas-frontend gets a
  follow-up card with this doc + the mockup as inputs.
- **Backend changes.** Per §7.1 (carl-cto, approved): bruno-backend
  picks up the `users.notifications_acknowledged_at` column + Save
  handler as a small follow-up card. Per §6.4: bruno also owns the
  `GET /api/setup/status` endpoint. Both are scoped from this spec
  but tracked separately on the kanban — not part of this design PR.
- **Multi-tenant variants** (org-level checklist that aggregates
  across users). Future card.
- **A/B testing the card vs. no-card.** We are confident the card
  is an improvement; if usage data later disagrees, revisit.
- **i18n.** English-only per the team i18n posture
  (ADR 2026-04-26).

---

## 10. Handoff notes for lucas-frontend

When the impl card lands:

1. **Tokens are already in tailwind.** Reuse `canvas`, `subtle`,
   `ink`, `muted`, `brand`. Don't add new ones.
2. **Single breakpoint: `tablet: 734px`.** No `md:` or `lg:`.
3. **The row IS the button.** Don't put a separate `<button>` only
   on the CTA pill — the whole row is clickable, focusable, one
   tab-stop. The CTA pill is visual affordance, not an extra target.
4. **Indicator → title baseline alignment matters.** The 20px
   indicator should align to the title's first-line baseline,
   not row-center. If the body wraps to two lines, the indicator
   stays at the top.
5. **Affirmation is 1500ms exactly.** Not "until the user clicks";
   not "until the page reloads"; 1500ms then unmount. Reduced-motion
   skips it.
6. **No new shadows.** This is a flat card — border-only.
7. **Section-highlight on scroll-to-anchor:** 1500ms outline ring,
   then 250ms fade. Don't keep it on indefinitely; it becomes noise.
8. **Test the 4 → 0 transition explicitly.** The page reflow when
   the card unmounts is the most likely place for jank. If anything
   feels rough, ping me and we'll iterate.
9. **Consume `GET /api/setup/status`, don't derive client-side.**
   The four booleans come from one backend call (§6.4). Coordinate
   with bruno-backend on the endpoint shape — it's small, but it has
   to land before your impl card can finish. `react-query` key
   `setup-status`; invalidate on Save in any of the four sections.
10. **Visible text + sr-only step counter, no row-level `aria-label`.**
    See §8 — the row `<button>` should let SR readers hear the
    title, body, and CTA verb naturally. Add only a sr-only span
    like `step 1 of 4, not started` for the positional context.

Open the mockup at `design/settings-setup-checklist.html` — every
class on this spec is in there as a working example. Lift the
classes verbatim.

Questions? Ping me in this thread or on the impl card when it opens.
