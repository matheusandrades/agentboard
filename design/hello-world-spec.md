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

| Token              | Size (desktop) | Size (mobile) | Weight | Line-height | Letter-spacing | Use                        |
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
│   ┌─────────────────┐   │
│   │   Say hello     │   │   ← full-width minus 22px padding
│   └─────────────────┘   │
│                         │
├─────────────────────────┤
│  Privacy · Terms        │
│  © 2026 Example         │
└─────────────────────────┘
```

---

## 5. Component specs

### 5.1 Top nav

- **Height:** 64px desktop, 48px mobile.
- **Background:** `#FFFFFF` at rest; when `scrollY > 8px`, switch to
  `rgba(255,255,255,0.8)` + `backdrop-filter: blur(20px)` and add a 1px
  bottom border in `border/hairline`.
- **Position:** `sticky; top: 0; z-index: 50`.
- **Wordmark:** left-aligned, 17px weight 500, `text/primary`.
- **Links:** right-aligned group, gap 32px, 14px, `text/primary`, no
  underline, hover darkens to `#000`. Mobile: hide, show "Menu" label
  (non-functional for v1 — just an affordance).

### 5.2 Hero

- **Container:** max-width 980px, centered, text-align center.
- **Vertical rhythm:** 96px top padding, 128px bottom padding (desktop).
  On mobile: 56px top / 72px bottom.
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
- **Mobile:** full width minus 22px horizontal page padding on either side.

### 5.4 Footer

- **Background:** `bg/subtle` (`#F5F5F7`).
- **Top border:** 1px `border/hairline`.
- **Padding:** 24px vertical, page padding horizontal.
- **Content:** two rows (links left, copyright right) on desktop; stacked
  on mobile.
- **Text:** 12px, `text/secondary`, links hover → `text/primary`.

---

## 6. Breakpoints

| Name     | Width              | Notes                                          |
| -------- | ------------------ | ---------------------------------------------- |
| mobile   | `< 734px`          | Single column, reduced typography              |
| tablet   | `734px – 1023px`   | Same layout as desktop, tighter padding        |
| desktop  | `≥ 1024px`         | Full spec above                                |

Use the actual Apple breakpoints (734 / 1024) — they're slightly unusual
but proven.

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
