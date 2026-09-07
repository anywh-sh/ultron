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

- `client/src/**/*.test.tsx` — unit/component tests, colocated. Run with `npm test` (`vitest run`, `npm run test:watch` for the watch mode). `happy-dom` environment, `@testing-library/react` + `@testing-library/jest-dom` (config in `client/vitest.config.ts`, matcher setup in `client/tests/setup.ts`, ambient types re-exposed to `tsc` via `client/src/vitest.d.ts` since `tests/` sits outside `tsconfig.json`'s `include`). A component driven by a timer (`setTimeout`/`setInterval` inside `useEffect`) needs `vi.useFakeTimers()` plus the timer advance wrapped in `act()` from `@testing-library/react`, or the state update lands outside a render React Testing Library knows to flush.
- `client/tests/ui/` — integration tests that render the full `App` (via `client/tests/ui/helpers/renderApp.tsx`, which wraps it in `TooltipProvider` the same way `main.tsx` does — `<App />` alone throws, any Tooltip-using component needs the provider), drive it via click/type like a user, and mock only the network edge (`client/tests/ui/helpers/fakeRelay.ts` stubs `WebSocket`/`fetch` — the client-side equivalent of the relay's `claude`-process boundary). Never assert on or reach into React state/context directly to shortcut a test; go through the UI. Known traps hit building this tier, now handled once in `client/tests/setup.ts` (or the fake relay helper) instead of per-test:
  - **Virtualized lists render zero rows in happy-dom.** `MessageLog.tsx` uses `@tanstack/react-virtual`, which measures the scroll container via `offsetWidth`/`offsetHeight` (its own `getRect`, not `getBoundingClientRect`) — happy-dom has no real layout engine, so both are always `0`, and the virtualizer computes an empty visible range regardless of how many entries exist in state. Fixed in `tests/setup.ts` by stubbing `HTMLElement.prototype.offsetWidth`/`offsetHeight` (plus `getBoundingClientRect` and a `ResizeObserver` that fires once synchronously — needed for other measurement paths even though the *initial* read turned out to be the actual blocker here). If a future virtualized component still renders empty under this tier, suspect a measurement this stub doesn't cover before suspecting the test's data.
  - **`caught_up` is a hard gate, not an optional nicety.** `useRelayClient`'s `ready` flag only flips true on `{"type":"caught_up"}` — until then `ChatPanel` shows a skeleton and won't render even the user's own just-sent bubble. Any fake relay for this tier must send it after `open`.
  - Tiptap's composer is a bare `[contenteditable]` with no explicit `role="textbox"` — query it with `findByLabelText`, not `findByRole("textbox", ...)`.
  - Radix's portal-based components (`Dialog`, `Popover`, `Tooltip`, `DropdownMenu`) render into `document.body`, not the app's root container — a query scoped to the rendered root will miss them; query `document.body` (or use `within(document.body)`) for portal content.
- `client/tests/e2e/` — end-to-end tests via WebdriverIO + `@wdio/tauri-service`, driving the real Tauri app (real window, real webview) on Windows/Linux/macOS. This is the only tier that can catch Tauri-webview-specific bugs (e.g. `window.confirm` unreliability, Radix focus-trap breaking under WKWebView — both already burned this project once, see `CLAUDE.md`). Expensive to run (builds the whole app), so CI only runs it on PRs that touch `client/src/**` or `client/src-tauri/**`, plus on release builds — not on every PR.

## When to test

New features and bug fixes should ship with tests. When fixing a bug, write the failing test first (reproduce the bug), then fix the code, then watch the test pass.

There is no coverage percentage target. The goal is covering main flows and the invariants/boundary cases that could actually break, not maximizing a number. A simplification that removes code usually does not need a new test; added complexity usually does.

## Determinism

Tests run in varied environments (including slower CI runners). Prefer explicit synchronization (wait-for-condition helpers) over arbitrary `sleep`/timeout-based waits, which are the main source of flaky tests.
