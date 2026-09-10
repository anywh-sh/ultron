import { homedir } from "node:os";

/**
 * "Default app folder" for a profile — used as the initial cwd of a new
 * session and as the fallback when `GET /fs/list` doesn't receive `path`.
 * Before this function existed, the fallback for the personal profile
 * (without `homeOverride`) was the relay process's `process.cwd()` — in
 * practice anywh's own source code folder (the systemd unit's
 * `WorkingDirectory`), not the user's actual $HOME. `homedir()` is the
 * correct fallback.
 */
export function defaultCwd(homeOverride: string | undefined): string {
  return homeOverride ?? homedir();
}
