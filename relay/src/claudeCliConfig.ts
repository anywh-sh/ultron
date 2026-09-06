import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Shared by every module that spawns `claude` (the real turn in
// claudeSession.ts, plus the one-shot probes in defaultModel.ts,
// titleGenerator.ts, suggestionGenerator.ts) — same binary, same PATH
// problem for all of them.
//
// Absolute path and explicit PATH: running via systemd the process doesn't
// have the user's interactive shell PATH (doesn't source .bashrc/.profile),
// so neither the binary nor tools it invokes internally (node, git...) would
// be found by name alone — same bug class already fixed for tmux in docs/08.
// Defaults to the bare command name, which works whenever the relay itself
// is started from a shell that already has `claude` on PATH (e.g. `npm run
// dev`); override via env for systemd or any other PATH-less launch.
export const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";

const configuredExtraPathDirs = (process.env.EXTRA_PATH_DIRS ?? "")
  .split(":")
  .filter((dir) => dir.length > 0);

// `relay/scripts` (not `dist/` nor `src/`) — the helper is a standalone bash
// script, doesn't need a build, and stays on PATH so a turn finds
// `ultron-bg` by name alone (see docs/32). Resolved relative to this file
// (not hardcoded) so it works whether running from `src/` (tsx) or `dist/`
// (tsc build) — both mirror the same layout one level below `relay/`.
const SCRIPTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../scripts");

// Prepended to every spawned child's PATH. `EXTRA_PATH_DIRS` env var is
// colon-separated, for any tool the child invokes that isn't already on the
// relay process's own PATH (e.g. a Node version manager's shim dir under
// systemd).
export const EXTRA_PATH_DIRS = [...configuredExtraPathDirs, SCRIPTS_DIR];
