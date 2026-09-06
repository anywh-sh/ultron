import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ClaudeEvent } from "./claudeSession.js";

// docs/32 Phase C — tracks jobs started via `ultron-bg` (relay/scripts)
// outside the turn's process, since the CLI's internal record for
// `run_in_background`/`BashOutput` disappears along with that turn's
// `claude -p`. Doesn't trigger any follow-up turn yet (Phase D) — it only
// detects the start marker and watches for completion via the `.exit` file,
// to validate detection in isolation before coupling it to anything that
// affects the user.

export interface BackgroundJobStarted {
  id: string;
  pid: number;
  log: string;
  exitFile: string;
  label: string;
}

export interface WatchedJob {
  sessionId: string;
  id: string;
  label: string;
  logPath: string;
  exitPath: string;
  startedAt: number;
  /** PID reported by `ultron-bg start` (docs/32 Phase F) — only used for
   * cancellation (`cancel`, `kill -<pid>` on the whole process group),
   * NEVER to detect completion (that's the `.exit` file's job; PID reuse by
   * the OS would mask a dead job as "still running"). `setsid` makes this
   * PID simultaneously the process's PID/PGID/SID — confirmed in practice
   * (docs/32, Phase A) —, so signaling the group (`-pid`) reaches
   * everything the command spawned, not just the root process. */
  pid: number;
}

/** Subset of `WatchedJob` safe to expose to the client (docs/32 Phase E) —
 * without `logPath`/`exitPath` (server-side file paths, internal detail)
 * nor `sessionId` (already implicit in the session's WS connection). */
export interface BackgroundJobSummary {
  id: string;
  label: string;
  startedAt: number;
}

export function toBackgroundJobSummary(job: WatchedJob): BackgroundJobSummary {
  return { id: job.id, label: job.label, startedAt: job.startedAt };
}

export interface FinishedBackgroundJob extends WatchedJob {
  exitCode: number;
  logTail: string;
}

// Only the marker line (one of potentially several lines of a Bash call's
// stdout) — doesn't assume it's the whole string, so it survives any extra
// output before/after it.
const MARKER_RE = /\{"ultron_bg":"started".*\}/;

/**
 * Pure (no I/O) parser for the marker that `ultron-bg start` prints —
 * separated from `extractStartedJobFromEvent` so it can be tested against
 * loose strings without having to build a whole `ClaudeEvent`.
 */
export function parseStartedMarker(text: string): BackgroundJobStarted | undefined {
  const match = MARKER_RE.exec(text);
  if (!match) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const { ultron_bg, id, pid, log, exitFile, label } = parsed as Record<string, unknown>;
  if (
    ultron_bg !== "started" ||
    typeof id !== "string" ||
    typeof pid !== "number" ||
    typeof log !== "string" ||
    typeof exitFile !== "string" ||
    typeof label !== "string"
  ) {
    return undefined;
  }
  return { id, pid, log, exitFile, label };
}

interface ToolResultBlock {
  type?: string;
  content?: unknown;
}

interface TextBlock {
  type?: string;
  text?: unknown;
}

/**
 * Real shape of a `tool_result` event in the stream-json (confirmed by
 * actually running `claude -p`, docs/32 Phase C): `type: "user"`,
 * `message.content` is an array of blocks; what matters here has
 * `type: "tool_result"` and `content` — a string in most cases observed,
 * but the API also allows an array of text blocks, so both are handled.
 */
function collectToolResultTexts(event: ClaudeEvent): string[] {
  if (event.type !== "user") return [];
  const message = event.message as { content?: unknown } | undefined;
  const content = message?.content;
  if (!Array.isArray(content)) return [];
  const texts: string[] = [];
  for (const block of content as ToolResultBlock[]) {
    if (!block || block.type !== "tool_result") continue;
    if (typeof block.content === "string") {
      texts.push(block.content);
    } else if (Array.isArray(block.content)) {
      for (const inner of block.content as TextBlock[]) {
        if (inner?.type === "text" && typeof inner.text === "string") texts.push(inner.text);
      }
    }
  }
  return texts;
}

export function extractStartedJobFromEvent(event: ClaudeEvent): BackgroundJobStarted | undefined {
  for (const text of collectToolResultTexts(event)) {
    const job = parseStartedMarker(text);
    if (job) return job;
  }
  return undefined;
}

function readExitCode(exitPath: string): number {
  const raw = readFileSync(exitPath, "utf8").trim();
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : -1;
}

/** Only the tail — same truncation pattern as
 * `notificationSummaryGenerator.ts`/`suggestionGenerator.ts`, but reading
 * only the last `maxBytes` of the file instead of loading everything into
 * memory (a noisy job can generate a large log). */
function readLogTail(logPath: string, maxBytes: number): string {
  const size = statSync(logPath).size;
  const start = Math.max(0, size - maxBytes);
  const length = size - start;
  if (length === 0) return "";
  const fd = openSync(logPath, "r");
  try {
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, start);
    return buffer.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

export interface BackgroundJobTrackerOptions {
  /** Called when a watched job finishes — Phase D triggers the follow-up
   * turn from this (see `sessionManager.ts`). */
  onFinished: (job: FinishedBackgroundJob) => void;
  /** Fired whenever a session's list of watched jobs changes — start,
   * completion, OR expiry from the ceiling (`maxWatchMs`). docs/32 Phase E:
   * this is what feeds the `background_job_state` the client uses for the
   * UI indicator ("there's a job running now"). Only `sessionId` — the
   * consumer fetches the current list via `listWatchedForSession`, it
   * doesn't get handed a ready-made array (avoids the callback going stale
   * if two changes happen in sequence before the listener reacts). */
  onChanged?: (sessionId: string) => void;
  /** ms between disk polls — split into an option (not a constant) just so
   * tests can use a short interval without depending on the production
   * value. */
  pollIntervalMs?: number;
  /** Observation ceiling — a job that never finishes (e.g. a dev server
   * left running on purpose) stops being watched after this, preventing the
   * list from growing unbounded. */
  maxWatchMs?: number;
  /** Log tail delivered in `FinishedBackgroundJob.logTail`. */
  logTailBytes?: number;
  /** Path to the persistence file (docs/32 Phase F) — if provided, the list
   * of watched jobs survives a relay restart: written on every change (same
   * synchronous pattern as `SessionStore`, `writeFileSync` of the whole
   * state), reloaded in the constructor, and polling resumed where it left
   * off. `undefined` (the tests' default) keeps the previous in-memory-only
   * behavior — without this, a restart mid-job would lose tracking forever
   * (edge case #10 of the plan). */
  persistPath?: string;
}

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_MAX_WATCH_MS = 6 * 60 * 60 * 1000;
const DEFAULT_LOG_TAIL_BYTES = 4000;

export class BackgroundJobTracker {
  private readonly jobs = new Map<string, WatchedJob>();
  private timer: NodeJS.Timeout | undefined;
  private readonly pollIntervalMs: number;
  private readonly maxWatchMs: number;
  private readonly logTailBytes: number;

  constructor(private readonly options: BackgroundJobTrackerOptions) {
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.maxWatchMs = options.maxWatchMs ?? DEFAULT_MAX_WATCH_MS;
    this.logTailBytes = options.logTailBytes ?? DEFAULT_LOG_TAIL_BYTES;

    if (this.options.persistPath) {
      for (const job of this.load(this.options.persistPath)) {
        this.jobs.set(`${job.sessionId}:${job.id}`, job);
      }
      // A job may have finished (or expired) while the relay was down —
      // don't wait for the first `pollIntervalMs` to find out, resolve this
      // right at boot. `setImmediate` (not a synchronous call here inside
      // the constructor): real finding while testing restart — whoever
      // instantiates this (`SessionManager`) only assigns its own field
      // after THIS constructor returns; an `onChanged`/`onFinished` fired
      // too synchronously via `pollOnce()` reached `SessionManager`'s
      // callback BEFORE it finished storing the tracker's reference, and
      // `this.backgroundJobs` (there) was still `undefined`.
      if (this.jobs.size > 0) {
        this.ensurePolling();
        setImmediate(() => this.pollOnce());
      }
    }
  }

  /** Never throws — a missing file (first time) or a corrupted one just
   * starts empty, same pattern as `SessionStore.load`. */
  private load(persistPath: string): WatchedJob[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(persistPath, "utf8"));
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is WatchedJob =>
        typeof entry === "object" &&
        entry !== null &&
        typeof entry.sessionId === "string" &&
        typeof entry.id === "string" &&
        typeof entry.label === "string" &&
        typeof entry.logPath === "string" &&
        typeof entry.exitPath === "string" &&
        typeof entry.startedAt === "number" &&
        typeof entry.pid === "number",
    );
  }

  /** Writes the whole state on every mutation — same synchronous,
   * debounce-free pattern as `SessionStore` (docs/18): job changes are rare
   * (start/finish/cancel, never on a poll tick), the cost of one more
   * `writeFileSync` doesn't matter. No-op if `persistPath` wasn't
   * configured. */
  private persist(): void {
    if (!this.options.persistPath) return;
    mkdirSync(dirname(this.options.persistPath), { recursive: true });
    writeFileSync(this.options.persistPath, JSON.stringify([...this.jobs.values()], null, 2));
  }

  /** Called with every `ClaudeEvent` of every turn (see
   * `SharedSession.runTurn`) — a no-op for almost all of them, only reacts
   * to the ones carrying the start marker. */
  observeEvent(sessionId: string, event: ClaudeEvent): void {
    const started = extractStartedJobFromEvent(event);
    if (!started) return;
    const key = `${sessionId}:${started.id}`;
    if (this.jobs.has(key)) return;
    this.jobs.set(key, {
      sessionId,
      id: started.id,
      label: started.label,
      logPath: started.log,
      exitPath: started.exitFile,
      startedAt: Date.now(),
      pid: started.pid,
    });
    this.ensurePolling();
    this.persist();
    this.options.onChanged?.(sessionId);
  }

  listWatched(): WatchedJob[] {
    return [...this.jobs.values()];
  }

  listWatchedForSession(sessionId: string): WatchedJob[] {
    return [...this.jobs.values()].filter((job) => job.sessionId === sessionId);
  }

  private ensurePolling(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.pollOnce(), this.pollIntervalMs);
    this.timer.unref?.();
  }

  /** Public only so tests can trigger a poll without waiting for the real
   * interval — `setInterval` in production calls this same method. */
  pollOnce(): void {
    const now = Date.now();
    for (const [key, job] of this.jobs) {
      if (now - job.startedAt > this.maxWatchMs) {
        console.warn(
          `[relay] background job "${job.label}" (${job.id}) expired without finishing after ${String(this.maxWatchMs)}ms — no longer watching`,
        );
        this.jobs.delete(key);
        this.persist();
        this.options.onChanged?.(job.sessionId);
        continue;
      }
      if (!existsSync(job.exitPath)) continue;
      this.jobs.delete(key);
      let exitCode: number;
      let logTail: string;
      try {
        exitCode = readExitCode(job.exitPath);
        logTail = readLogTail(job.logPath, this.logTailBytes);
      } catch (error) {
        console.error(`[relay] failed reading background job result "${job.label}" (${job.id}):`, error);
        this.persist();
        this.options.onChanged?.(job.sessionId);
        continue;
      }
      this.persist();
      this.options.onFinished({ ...job, exitCode, logTail });
      this.options.onChanged?.(job.sessionId);
    }
    if (this.jobs.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** docs/32 Phase F — cancellation from the UI. Kills the WHOLE process
   * GROUP (negative `pid`, reaches everything the command spawned, not just
   * the root process), doesn't go through `.exit`/`onFinished`: unlike a job
   * that finishes on its own, whoever cancelled it already knows it was
   * cancelled (they clicked the button), an automatic follow-up turn
   * summarizing "it was cancelled" would be redundant noise. `SIGTERM`
   * first (gives a chance to clean up temp files etc.), `SIGKILL` ~2s later
   * for anything that ignores the first one — same standard practice as
   * tools like `timeout(1)`. Returns `false` with no effect if the job is
   * no longer being watched (it finished on its own or was already
   * cancelled before) — a race is possible between the user clicking
   * "cancel" and the next poll finding the `.exit`. */
  cancel(sessionId: string, jobId: string): boolean {
    const key = `${sessionId}:${jobId}`;
    const job = this.jobs.get(key);
    if (!job) return false;

    this.jobs.delete(key);
    this.persist();
    this.options.onChanged?.(sessionId);

    try {
      process.kill(-job.pid, "SIGTERM");
    } catch {
      // Group no longer exists (the job had just finished on its own right
      // at this instant) — nothing to kill, but the list was already updated above.
      return true;
    }
    setTimeout(() => {
      try {
        process.kill(-job.pid, "SIGKILL");
      } catch {
        // Already died from the SIGTERM — expected in most cases.
      }
    }, 2000).unref();
    return true;
  }

  /** Only for tests/shutdown — production never needs to stop the poller
   * while the process is alive. */
  stopPolling(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
