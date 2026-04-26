# ADR 0001 — i18n: stay English-only; pre-commit `react-i18next` + dotted keys for the day we flip

- **Status:** Accepted
- **Date:** 2026-04-25
- **Author:** carl-cto
- **Related task:** 3cd3a6f8 (Melhorai continua) — raised by leo-langs, seconded by alice-pm
- **Relates to:** `docs/style-guide.md` §4 (commit `706e697`)

> Note: this ADR was authored as a markdown file because the agentboard
> `record_decision` MCP was unreachable at the time of writing. Treat this
> file as the canonical decision until / unless re-recorded via the tool.

## Context

The stakeholder writes pt-BR and the broad mandate on task 3cd3a6f8 is "be #1 in the world." The product is currently English-only with no i18n scaffolding. Leo landed `docs/style-guide.md` (commit `706e697`) marking the current English-only posture and adding forward-looking i18n-ready rules: no concatenated phrases, named placeholders, `Intl.*` for dates/numbers, logical-property CSS.

Leo asked for a binary call:

1. **Stay English-only for now.** Lower review surface, faster iteration, defer i18n.
2. **Go i18n now.** Scaffold `react-i18next`, add `en` + `pt-BR`, extract strings page by page.

Alice flagged the same fork because she's holding implementer dispatch on task 7c9bd1ad until it's resolved.

## Decision

**Option 1 — stay English-only.** No `apps/web/src/locales/*.json`, no extraction pipeline, no `react-i18next` install today. Style-guide §4 stays as-written and gets a one-sentence pointer to this ADR so the next reader sees "deferred deliberately," not "forgotten."

## Why

1. **No translated consumer.** The stakeholder writes pt-BR but consumes the *running app and the agent transcripts*. There is no audience asking for the UI itself in pt-BR.
2. **"#1 in the world" is a GTM aspiration, not a roadmap commitment.** No public launch, no paying customer, no non-EN contributor on the product surface. Building i18n machinery before there's a market is busywork that taxes every PR — review surface, key-naming bikesheds, missing-key bugs.
3. **The style guide already buys us optionality.** Named placeholders, no concatenation, `Intl.*` for dates/numbers, logical-property CSS — those keep us i18n-*ready* without paying the i18n *cost*. Leo's framing was correct: extracting strings to a file we don't translate is just busywork.
4. **The cost of flipping later is small.** If the rules above are followed in everyday code, a focused one-week sprint can do the extraction and library wiring when a real trigger arrives.

## Triggers that flip this decision

Reopen this ADR the moment **any** of these happen:

- A paying customer or design partner asks for pt-BR (or any non-EN) UI.
- A public launch is committed with multilingual support in scope.
- A non-EN contributor joins the *product* surface (not orchestrator/infra).
- We start shipping marketing pages or docs in a second language.

## Pre-committed shape (so the next revisit is trivial)

When we DO flip — these are pre-decided so we don't re-debate the library:

- **Library:** `react-i18next`. Boring default, large ecosystem, SSR-compatible, Storybook-friendly.
  - Rejected: `react-intl` (heavier, ICU is overkill at our scale).
  - Rejected: `lingui` (smaller community, build-step quirks).
- **Key format:** flat dotted, `surface.subject.thing` (e.g. `board.empty.title`, `task.actions.archive`). Easier to grep, easier to lint, no nested-object diffs.
- **Source location:** `apps/web/src/locales/<lang>.json`, with `en` as canonical.
- **Pipeline:** build-time extraction (`i18next-parser` or equivalent). No runtime fetch — keys ship in the bundle. Re-evaluate only if bundle bloat exceeds ~30 KB gzipped per locale.
- **First two locales:** `en`, `pt-BR`.
- **Day-1 enforcement when flipped:** ESLint rule banning raw string children in JSX inside `apps/web/src/**`, with an allowlist for code/dev surfaces (logs, debug panels).

## Constraints to know now

- **No build-size, SSR, or Storybook constraints today.** When we flip, react-i18next plays nice with all three.
- **Style-guide §4 update:** add one sentence under §4 noting this ADR's title and the trigger list, so the next reader sees "deferred deliberately."

## What this means today

- **leo-langs:** do **not** scaffold locales. Update style-guide §4 to point at this ADR. Continue enforcing the i18n-ready rules in PR review.
- **alice-pm:** dispatch the wave; i18n is not in this sprint.
- **Everyone else:** write English. Follow the style-guide rules so the future flip is cheap.

## Revisit

When any trigger above fires. Don't reverse without recording a new decision that explains the flip.

— carl-cto
