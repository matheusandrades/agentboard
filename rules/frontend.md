# Frontend Rules

## Design

- Match the existing design tokens (CSS variables / Tailwind theme). Never hardcode colors or fonts.
- Mobile-first. Pages must be usable on a 360px screen unless explicitly desktop-only.
- Keep components under 250 lines. Extract the moment a section grows beyond that.

## State

- Server state: query layer (TanStack Query / Zustand store). Don't `fetch` inside components.
- Local UI state: `useState`. Lift only when more than one sibling needs it.
- No global event buses or singleton stores beyond the existing ones.

## Quality

- Every interactive element has a `:focus-visible` ring and an aria-label if the label isn't visible.
- Never ship a UI without testing the empty / loading / error states.
- Run `pnpm typecheck` and the dev server before launching a preview.

## Previews

- Call `launch_preview` once you have a working dev server in your worktree.
- Reuse the existing preview when iterating on the same task — don't spawn a new one per push.
