# Design Spec — Apple-style Hello World

**Status:** ready for implementation
**Owner:** uma-uiux → lucas-frontend
**Related flow:** [`design/flows/hello-world.md`](./flows/hello-world.md)
**Mockup:** [`design/hello-world.html`](./hello-world.html) (open in a browser)

> Apple's visual language is built on three things: generous whitespace,
> precise typography, and a single focal point per view. Copy those instincts
> more than any specific hex.

---

## 1. Typography

Use the system SF stack so macOS/iOS users get San Francisco natively and
everyone else falls back gracefully.

```css
font-family:
  -apple-system, BlinkMacSystemFont,
  "SF Pro Display", "SF Pro Text",
  "Helvetica Neue", Helvetica, Arial,
  system-ui, sans-serif;
```

Sizes below list **mobile (< 734px)** vs **tablet+desktop (≥ 734px)**.
This page has a **single layout breakpoint at 734px** — see §6.

| Token              | Size (≥734px)  | Size (<734px) | Weight | Line-height | Letter-spacing | Use                        |
| ------------------ | -------------- | ------------- | ------ | ----------- | -------------- | -------------------------- |
| `display/hero`     | 80px (5rem)    | 48px (3rem)   | 600    | 1.05        | -0.015em       | "Hello World" headline     |
| `body/tagline`     | 24px (1.5rem)  | 19px (≈1.2rem)| 400    | 1.4         | 0              | Hero subhead               |
| `ui/nav`           | 14px           | 14px          | 400    | 1           | -0.01em        | Top nav links              |
| `ui/button`        | 17px           | 17px          | 400    | 1           | -0.01em        | CTA label                  |
| `body/footer`      | 12px           | 12px          | 400    | 1.5         | 0              | Footer legal & links       |

Rules:
- Headline weight is **600, not 700** — Apple rarely goes full bold.
- Negative letter-spacing on the display size keeps it from feeling airy.
- Never center-align body paragraphs longer than one line. The tagline is
  one line, so centering is fine here.

---

## 2. Color palette

A three-tone neutral + one accent. That's it.

| Token               | Hex        | Use                                                  |
| ------------------- | ---------- | ---------------------------------------------------- |
| `bg/canvas`         | `#FFFFFF`  | Page background                                      |
| `bg/subtle`         | `#F5F5F7`  | Footer background, alt sections                      |
| `text/primary`      | `#1D1D1F`  | Headlines, nav, body (Apple uses this, not pure #000)|
| `text/secondary`    | `#86868B`  | Tagline, footer copy, deemphasized text              |
| `border/hairline`   | `rgba(0,0,0,0.08)` | Nav bottom border on scroll, footer top      |
| `accent/blue`       | `#0071E3`  | Primary CTA, focus ring                              |
| `accent/blue-hover` | `#0077ED`  | CTA hover                                            |
| `accent/blue-active`| `#006EDB`  | CTA active / pressed                                 |

Notes:
- **Do not use `#000000` for text.** `#1D1D1F` is softer and matches apple.com.
- Focus ring uses `rgba(0,113,227,0.4)` — same blue, lower alpha.

---

## 3. Spacing scale

8-point grid. Everything is a multiple of 8 except the hairline (1px) and
the focus ring offset (2px).

| Token   | Value | Typical use                              |
| ------- | ----- | ---------------------------------------- |
| `s-1`   | 8px   | Inline gaps (icon ↔ label)               |
| `s-2`   | 16px  | Nav link gap, small vertical rhythm      |
| `s-3`   | 24px  | Headline → tagline                       |
| `s-4`   | 32px  | Tagline → CTA                            |
| `s-6`   | 48px  | Nav height (mobile)                      |
| `s-7`   | 56px  | Section padding block, mobile            |
| `s-8`   | 64px  | Nav height (desktop)                     |
| `s-12`  | 96px  | Hero top padding (desktop)               |
| `s-16`  | 128px | Hero bottom padding (desktop)            |

Container max-width: **980px**, horizontally centered, `padding-inline: 22px`
on mobile, `44px` on tablet, auto on desktop.

---

## 4. Layout — ASCII wireframe

### Desktop (≥ 1024px)

```
┌────────────────────────────────────────────────────────────────┐
│  ≡ logo         Product   Support   About            Sign in   │  ← nav, 64px tall, sticky
├────────────────────────────────────────────────────────────────┤
│                                                                │
│                                                                │
│                                                                │
│                        Hello World                             │  ← 80px, weight 600, #1D1D1F
│                                                                │
│            A quiet greeting from a calm corner                 │  ← 24px, #86868B
│                     of the internet.                           │
│                                                                │
│                     ┌──────────────┐                           │
│                     │   Say hello  │                           │  ← CTA, #0071E3, 17px
│                     └──────────────┘                           │
│                                                                │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│  Made with care · Privacy · Terms              © 2026 Example  │  ← footer, #F5F5F7 bg
└────────────────────────────────────────────────────────────────┘
```

### Mobile (< 734px)

```
┌─────────────────────────┐
│  ≡ logo          Menu   │   ← nav, 48px
├─────────────────────────┤
│                         │
│                         │
│      Hello World        │   ← 48px
│                         │
│   A quiet greeting      │   ← 19px
│   from a calm corner    │
│   of the internet.      │
│                         │
│     ┌───────────┐       │
│     │ Say hello │       │   ← content-width pill, centered
│     └───────────┘       │
│                         │
├─────────────────────────┤
│  Privacy · Terms        │
│  © 2026 Example         │
└─────────────────────────┘
```

---

## 5. Component specs

### 5.1 Top nav

- **Height:** 64px at `≥ 734px`, 48px below. (Tablet uses the desktop nav
  — only true mobile gets the shorter bar.)
- **Background:** `#FFFFFF` at rest; when `scrollY > 8px`, switch to
  `rgba(255,255,255,0.8)` + `backdrop-filter: blur(20px)` and add a 1px
  bottom border in `border/hairline`.
- **Position:** `sticky; top: 0; z-index: 50`.
- **Wordmark:** left-aligned, 17px weight 500, `text/primary`.
- **Links:** right-aligned group, gap 32px, 14px, `text/primary`, no
  underline, hover darkens to `#000`. Visible at `≥ 734px` (tablet +
  desktop). Below 734px: hide the link list, show "Menu" label
  (non-functional for v1 — just an affordance).
- **Breakpoint:** the mobile↔desktop-nav switch is **734px**, not 768px
  (Tailwind's default `md`) and not 1024px. Use a custom media query.

### 5.2 Hero

- **Container:** max-width 980px, centered, text-align center.
- **Vertical rhythm:** 96px top / 128px bottom at `≥ 734px`.
  56px top / 72px bottom at `< 734px`.
- **Horizontal padding:** 22px at `< 734px`, 44px at `≥ 734px`
  (falls to auto once the 980px container fits).
- **Headline → tagline:** 24px gap.
- **Tagline → CTA:** 32px gap.

### 5.3 CTA button

- **Shape:** `border-radius: 980px` (pill) — Apple's signature.
- **Padding:** `12px 22px`.
- **Background:** `#0071E3`, text `#FFFFFF`, 17px weight 400.
- **Hover:** bg `#0077ED`, transition `background-color 200ms ease`.
- **Active:** bg `#006EDB`.
- **Focus-visible:** outline `3px solid rgba(0,113,227,0.4)`, offset `2px`.
- **Disabled:** bg `#0071E3` at 40% opacity, cursor `not-allowed`.
- **Width:** content-width at every breakpoint. Centered in the hero,
  never full-bleed. (Apple's CTAs hug their label — a full-width pill on
  mobile reads as a form button, not a marketing action.)

### 5.4 Footer

- **Background:** `bg/subtle` (`#F5F5F7`).
- **Top border:** 1px `border/hairline`.
- **Padding:** 24px vertical. Horizontal follows the page scale:
  22px at `< 734px`, 44px at `≥ 734px` (auto once the 980px
  container fits).
- **Content:** stacked (links above copyright) at `< 734px`;
  single row (links left, copyright right) at `≥ 734px`.
- **Text:** 12px, `text/secondary`, links hover → `text/primary`.

---

## 6. Breakpoints

**This page has exactly one layout breakpoint: 734px.** Everything that
changes between phone and not-phone changes at 734 — nav height, nav link
visibility, hero typography, hero padding, footer layout, footer padding.
No rule should flip at any other pixel value.

| Name     | Width              | What changes at this boundary                                          |
| -------- | ------------------ | ---------------------------------------------------------------------- |
| mobile   | `< 734px`          | Single column · reduced typography (48px hero, 19px tagline) · "Menu" affordance · 48px nav height · 22px page padding · stacked footer |
| tablet+  | `≥ 734px`          | Desktop-style nav (links visible, 64px tall) · full typography (80px hero, 24px tagline) · 44px page padding · single-row footer |

> **1024px is NOT a layout breakpoint.** Nothing that a user perceives
> as "the page restructured" happens there. The only rule that touches
> 1024 is a CSS-math correction: once the 980px container is fully
> visible, its internal horizontal padding is zeroed so that the auto
> left/right margins (`margin: 0 auto`) can handle side space on their
> own. Without that zeroing you'd get *both* margin AND padding on each
> side — 88px of empty space per side on a wide screen, which reads as
> loose. So at `≥ 1024px`:
>
> ```css
> .nav__inner,
> .hero,
> .footer__inner { padding-inline: 0; }
> ```
>
> This is bookkeeping, not a layout change. Users don't notice a
> restructure — they see the container sit where it was going to sit
> anyway, just without double-spacing at the edges. (Pedantically the
> math line is 1068px = 980 + 44×2, but 1024 is the conventional pixel
> to anchor to, and the 44px window between 1024–1068 just shows a
> slightly narrower container; no visual glitch.)

> Implementation note: Tailwind's default `md` breakpoint is 768px, which
> is *close to* but not 734. Extend the theme
> (`screens: { tablet: '734px' }`) and use `tablet:` as the only
> responsive prefix on this page. Do not use `md:` or `lg:`.

---

## 7. Accessibility

- Contrast: `#1D1D1F` on `#FFFFFF` = 18.9:1 ✅. `#86868B` on `#FFFFFF` =
  4.05:1 — passes AA for large text only; **don't use it for body copy
  smaller than 18px** (the tagline is 24px, so it's fine).
- Focus ring is visible and non-ambiguous (see 5.3).
- Headline is a single `<h1>`. Tagline is a `<p>`. CTA is a `<button>`
  (or `<a role="button">` if it navigates).
- Respect `prefers-reduced-motion`: drop the 200ms transitions to 0ms.

---

## 8. What NOT to do

- No drop shadows on the CTA. Apple rarely shadows flat UI.
- No gradients. Flat color only.
- No emoji in the headline (yes, really).
- No autoplay anything.
- No border on the CTA button.

---

## 9. Handoff notes for lucas-frontend

1. Static HTML + CSS is enough — no JS except the `scroll > 8px` nav
   class toggle.
2. Font stack is the single most important detail. Don't import any web
   font.
3. The mockup at `design/hello-world.html` has working Tailwind classes
   you can lift directly, but final implementation can use plain CSS if
   that fits the project better.

Questions? Ping me or ask in thread.
