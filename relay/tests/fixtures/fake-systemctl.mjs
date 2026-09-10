#!/usr/bin/env node
// Second sanctioned mock boundary, alongside `fake-claude.mjs` (see
// .anywh/skills/tests/SKILL.md) — stands in for the real `systemctl`
// binary via the `SYSTEMCTL_BIN` env var (relay/src/server.ts), used only by
// `DELETE /control/profiles/:id`. Added after a real incident (2026-09-07):
// an integration test hitting that route with the real `systemctl` disabled
// and stopped the operator's actual live `anywh-relay@trabalho` service,
// SIGKILLing an in-flight `claude` conversation. `systemctl --user` has no
// concept of "this is a test" the way an isolated `$HOME`/port/env-dir does
// for everything else this route touches — there's no sandboxed form of the
// real command to call instead, so (like the `claude` process itself) it
// gets a fake substituted in tests, never the real binary.
//
// Always succeeds (exit 0, no output) — the route only cares about the exit
// code (best-effort cleanup either way, see server.ts), and no test in this
// repo asserts on systemd's own state.
process.exit(0);
