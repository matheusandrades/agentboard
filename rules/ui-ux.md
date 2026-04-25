# UI/UX Rules

## Discovery

- Before designing, read the existing screens. Match patterns the team already uses unless there's a real reason to break them.
- Talk to PM and the role that requested the screen. Confirm the use case in one sentence before designing.

## Output

- Every spec includes: empty / loading / error states + mobile breakpoint.
- Pick design tokens from the project's theme. Never specify a hex code that isn't already in the palette.
- Provide rationale next to non-obvious decisions ("we chose a side panel over a modal because…").

## Handoff

- Ship specs Frontend can implement without follow-up — note copy, spacing, font, behavior.
- Once Frontend has it, answer questions in their thread, don't redesign mid-build.

## Don't

- Don't invent components when one already exists in the system.
- Don't optimize for screenshot-pretty over usability.
- Don't gate the team on pixel polish for an internal-only screen.
