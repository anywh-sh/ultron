---
name: tests
description: Testing doctrine, test layout conventions, and where each kind of test lives in the ultron repo
---

# Testing Guidelines

## Testing Doctrine

Two kinds of test are preferred, in this order:

1. **Real integration tests** — real filesystem, real HTTP/WebSocket connections, real child processes where feasible. No mocks/stubs/fakes for anything the repo itself controls.
2. **Unit tests on pure/isolated logic** — pure functions or well-isolated modules where inputs and outputs are clear enough that no mock is needed.

Avoid mock-heavy tests that assert on implementation detail instead of behavior. If a piece of code can only be tested by mocking half its dependencies, that is a signal the code should be restructured to be more testable, not a signal to add more mocks.

Avoid tautological tests (tests that just restate the implementation). Favor tests that pin down an invariant or a boundary case that could plausibly break.

## The one sanctioned mock boundary: the `claude` process

The relay's job is to spawn `claude -p ...` per turn and stream its JSON events back over WebSocket. That external process is the one dependency that cannot be exercised for real in a test: it needs a live subscription, it is not deterministic, and it must never run in CI.

For relay integration tests, the sanctioned exception is a fake `claude` executable — a small script that emits canned JSON stream events on stdout — substituted for the real one via `PATH`/spawn override for the duration of the test. Everything else in that test (the HTTP server, the WebSocket layer, session persistence to disk, profile registry) runs for real, unmocked. This is the same shape of exception `mockAiRouter` plays in other coding-agent-desktop-app codebases: one deliberate seam at the LLM boundary, nowhere else.

## Where tests live

### `relay/`

- `relay/src/*.test.ts` — unit tests, colocated with the module they test. Run with `npm test` (`node:test`).
- `relay/tests/*.test.ts` — integration tests. Run with `npm run test:integration` (`npm run test:all` runs both). Each test file gets `server.ts` imported for its side effects against a throwaway `$HOME`/sessions file (`relay/tests/helpers/testServer.ts`, one call per file — `server.ts` has no exported bootstrap function and `node --test` already isolates each file in its own subprocess) and talks to it over a real WebSocket (`relay/tests/helpers/wsClient.ts`). `CLAUDE_BIN` points at `relay/tests/fixtures/fake-claude.mjs`, the fake executable described above — everything else is real.

### `client/`

- `client/src/**/*.test.tsx` — unit/component tests, colocated. Vitest + Testing Library.
- `client/tests/ui/` — integration tests that render the full `App`, drive it via click/type like a user, and mock only the network edge (the relay's WebSocket/HTTP surface — the client-side equivalent of the relay's `claude`-process boundary). Never assert on or reach into React state/context directly to shortcut a test; go through the UI.
- `client/tests/e2e/` — end-to-end tests via WebdriverIO + `@wdio/tauri-service`, driving the real Tauri app (real window, real webview) on Windows/Linux/macOS. This is the only tier that can catch Tauri-webview-specific bugs (e.g. `window.confirm` unreliability, Radix focus-trap breaking under WKWebView — both already burned this project once, see `CLAUDE.md`). Expensive to run (builds the whole app), so CI only runs it on PRs that touch `client/src/**` or `client/src-tauri/**`, plus on release builds — not on every PR.

## When to test

New features and bug fixes should ship with tests. When fixing a bug, write the failing test first (reproduce the bug), then fix the code, then watch the test pass.

There is no coverage percentage target. The goal is covering main flows and the invariants/boundary cases that could actually break, not maximizing a number. A simplification that removes code usually does not need a new test; added complexity usually does.

## Determinism

Tests run in varied environments (including slower CI runners). Prefer explicit synchronization (wait-for-condition helpers) over arbitrary `sleep`/timeout-based waits, which are the main source of flaky tests.
