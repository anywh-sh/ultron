## What and why

<!-- What changes, and what problem it solves. The diff already says what the
     code does — use this space for the reasoning a reviewer can't reconstruct
     from it. Link the issue: "Closes #123". -->

## How it was verified

<!-- Which tests you added or ran, and anything you checked by hand that tests
     don't cover (a specific platform, a real device, a relay over a tailnet). -->

## Checklist

- [ ] Tests cover the change, and the relevant tiers pass locally
      (`npm run test:all` in `relay/`, `npm test` in `client/`)
- [ ] Comments, commit messages and logs are in English
- [ ] User-facing strings go through `client/src/i18n/` with both `en` and
      `pt-br` filled in — no literals in components
- [ ] Commits are atomic and follow Conventional Commits
- [ ] The PR title is a Conventional Commits line (it becomes the squashed
      commit on `main`)

## Notes for the reviewer

<!-- Anything deliberately left out, a known limitation, a decision you're
     unsure about, or a follow-up you plan to open. Optional. -->
