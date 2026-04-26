# Flow — `/settings` Setup Checklist

A top-of-page card that orients first-time users on `/settings`. It exists
*only* while at least one required integration is incomplete; once a
project is fully configured the card is removed from the DOM and `/settings`
returns to its normal "wall of options" — which is fine, by then the user
knows the lay of the land.

> **Why this exists:** highest-leverage gap from the empty-state audit
> (`docs/ux/empty-states-audit.md` §1, §4.12). Today a first-time user
> opens `/settings` and sees a wall of fields with no narrative. This card
> gives them a 4-step ladder.

---

## States & transitions

### Page-level states

1. **Hidden.** The card is not rendered when *all four* items are done. No
   "Setup complete" affirmation lives in the DOM at rest. (Don't celebrate
   emptiness — see audit voice rule §3.)
2. **Visible — incomplete.** The card renders at the top of `/settings`,
   above all settings sections. At least one item is `not_started` or
   `in_progress`.
3. **Visible — completing.** The user has just checked the last item.
   Card shows a 1.5s "✓ All set" affirmation in place, then unmounts.
   This is the *only* moment the card celebrates completion — it's
   transient, not persistent.
4. **Hidden — first load post-completion.** Subsequent renders skip the
   card entirely. There is no "show again" toggle (would be noise; the
   settings sections themselves are still there).

### Per-item states

Each of the 4 items has three visual states:

1. **`not_started`.** Empty circle indicator (◯). Title in `text/primary`.
   One-line body in `text/secondary` explaining why the step matters.
   "Set up" CTA on the right.
2. **`in_progress`.** Half-filled circle (◐) OR a spinner if the system
   is genuinely loading. Title and body unchanged. CTA reads "Continue".
   (Used when a step has multi-stage server-side work, e.g., GitHub App
   installation in progress on the GitHub side.)
3. **`done`.** Filled circle with checkmark (●✓) in `accent/blue`. Title
   in `text/secondary` (de-emphasized, but **never strikethrough** — that
   reads as "deleted" rather than "complete"). Body hidden. "Edit" link
   on the right (so a user who *did* the step can still revise it).

### Interaction transitions

1. **CTA click on a `not_started` or `in_progress` item.** Smooth-scroll
   to the relevant settings section anchor (e.g., `#integrations`,
   `#api-keys`, `#projects`, `#notifications`). Highlight the section
   briefly with a 1.5s outline ring in `accent/blue` at 30% alpha so the
   user's eye lands on the right spot. **Do NOT open a modal.** The
   settings sections are where the user needs to operate; bouncing them
   into a modal and back creates a context-switch loop.
2. **Step completes.** When a backend signal flips a step to `done`, the
   item animates: indicator fades from ◯ → ●✓ over 200ms; title fades from
   `text/primary` → `text/secondary`; body collapses to 0px height over
   200ms. No bounce, no confetti.
3. **Last step completes.** The full card transitions to its
   "completing" state for 1.5s (small green check + "All set" line),
   then unmounts. The settings page reflows up by the card's height.
4. **Hover on a `not_started` item row.** Background tints to
   `bg/subtle` over 150ms. Helps the user see which row their cursor
   maps to before they read the CTA.

---

## Out of scope (this flow)

- Backend ack endpoint for "user has acknowledged notifications"
  (covered in spec §7 Open Questions — pending carl-cto sign-off).
- A "skip for now" affordance. Decided against: the card already
  removes itself once items are done; an explicit "skip" turns the card
  into something the user must dismiss, which is the opposite of helpful.
- Multi-tenant scope (org-level vs user-level checklist). v1 is per-user;
  org-level rollups are a future card.
- Localization. English-only per current team i18n posture
  (ADR 2026-04-26).

## What "done" looks like

A first-time user lands on `/settings`, sees a single card at the top
with their name on it ("Get set up — 4 steps to a working agent"),
clicks "Set up" on the first item, gets scrolled to the integrations
section, connects GitHub, watches that line tick to ✓, repeats for the
other three. After the last tick the card briefly shows "✓ All set",
then disappears. They never see the card again. The settings page they
were always going to see is now there, exactly where it always was —
but they understand it.
