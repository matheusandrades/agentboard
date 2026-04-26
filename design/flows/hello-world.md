# Flow — Hello World landing page

A one-page, one-viewport landing. No routing, no auth. The user arrives, reads
the headline, maybe clicks the CTA, and leaves feeling something calm.

## States & transitions

1. **Default (loaded).** Page paints hero + nav + footer. No spinners — it's
   static HTML; first paint should be the content.
2. **Nav hover.** Link color shifts from `#1d1d1f` → `#000` with 150ms ease;
   no underline (Apple never underlines nav on hover).
3. **CTA hover.** Button background brightens from `#0071e3` → `#0077ED`,
   cursor becomes `pointer`, 200ms ease.
4. **CTA focus (keyboard).** 3px outline ring in `#0071e3` at 40% opacity,
   offset 2px. Accessibility is not optional.
5. **CTA active (pressed).** Background darkens to `#006EDB`, no scale
   transform — Apple keeps buttons flat, no bounce.
6. **Scroll.** Top nav gains a subtle `backdrop-filter: blur(20px)` and a
   hairline `1px` bottom border in `rgba(0,0,0,0.08)` once `scrollY > 8px`.
7. **Mobile (< 734px).** Nav collapses link list; only the wordmark + a
   single ghost "Menu" affordance remain. Hero text scales down.

## Out of scope
- No real routing on the CTA — href="#" for the mockup.
- No dark mode for v1 (note it as a future enhancement).
- No localization — English only (if that changes, loop in leo-langs).

## What "done" looks like
A visitor lands, sees a clean hero with "Hello World" in a big SF-style
headline, a short tagline, and one blue CTA. On mobile, everything reflows
to a single column with comfortable padding. Nothing moves, nothing loads,
nothing distracts.
