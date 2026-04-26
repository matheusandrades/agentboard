# Design Spec — `/settings` Setup Checklist

**Status:** ready for review (carl-cto for architectural fit, then merge)
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
4. **Verify notifications** (lowest blocker — defaults work; this is "you've seen it").

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
│  │     Agents call OpenAI or Anthropic           │  │
│  │     to think.                                 │  │
│  │                                               │  │
│  │  ◯ Add a project                   [Set up →] │  │
│  │     Pick a repo for agents to work in.        │  │
│  │                                               │  │
│  │  ◯ Verify notifications            [Set up →] │  │
│  │     Choose how we ping you when an            │  │
│  │     agent needs a call.                       │  │
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
| 2. Model key    | Add a model API key| Agents call OpenAI or Anthropic to think.              |
| 3. Project      | Add a project      | Pick a repo for agents to work in.                     |
| 4. Notifications| Verify notifications| Choose how we ping you when an agent needs a call.    |

Copy is uma-uiux draft. Per audit §3, voice copy needs `leo-langs`
sign-off before impl PR ships. Hand off to him after carl-cto's
architectural review.

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
- **Body:** "Refresh the page or check your connection."
- **CTA:** "Retry"

This is the conventional error pattern — a soft fallback rather than
a banner. Don't blow up the whole page; the rest of `/settings` is
still useful even if we can't render the checklist.

---

## 7. Open questions (for carl-cto review)

Asked carl-cto separately (thread `4c37950f-…`); flagging here so
they don't get lost:

1. **Notifications "verified" — derive or persist?** Today the
   notifications section may render with defaults the user never
   explicitly touched. The spec assumes we'll add a small per-user
   `notifications_acknowledged_at` flag (or equivalent: a per-user
   key in existing settings JSON) so item 4 has a true "user looked
   at this" signal. Acceptable, or do we treat default-on as `done`
   and skip the ack step entirely (in which case item 4 starts as
   `done` for everyone and the checklist is really 3 items)?
2. **Model API key check cost.** Item 2's `done` predicate is "user
   has at least one provider key saved." On every `/settings` render
   we'd evaluate this. If keys are stored encrypted server-side,
   confirm "has any key" is a cheap boolean, not a decryption round-trip.
3. **`/settings` route ownership.** The spec assumes a single page
   at `/settings` that contains anchor sections for `#integrations`,
   `#api-keys`, `#projects`, `#notifications`. If the actual layout
   is split into `/settings/integrations`, etc., the deep-link
   targets change but the design doesn't — flag if so and lucas
   adjusts the `href`s.

I'm not blocked on these; the spec stands on the assumption "each
done state is derivable, with one small ack added for notifications."
carl-cto's answer goes here as an addendum once it lands.

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
  - State changes announce via `aria-live="polite"` region containing
    text like "Connect GitHub: completed".
- **Keyboard.** Tab moves through items in order. Enter or Space
  triggers the CTA. Escape on a focused row does nothing (the row
  is not modal).
- **Reduced motion.** All transitions become 0ms. Affirmation
  unmounts immediately. Shimmer becomes a static bar.

---

## 9. Out of scope

- **Implementation.** This spec is design only; lucas-frontend gets a
  follow-up card with this doc + the mockup as inputs.
- **Backend changes.** If §7 Q1 lands as "yes, add an ack flag",
  bruno-backend gets a small ticket. Not blocking the design merge.
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

Open the mockup at `design/settings-setup-checklist.html` — every
class on this spec is in there as a working example. Lift the
classes verbatim.

Questions? Ping me in this thread or on the impl card when it opens.
