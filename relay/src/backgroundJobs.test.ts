import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { ClaudeEvent } from "./claudeSession.js";
import {
  BackgroundJobTracker,
  extractStartedJobFromEvent,
  parseStartedMarker,
  type FinishedBackgroundJob,
} from "./backgroundJobs.js";

const STARTED_JSON =
  '{"ultron_bg":"started","id":"1788022610814662237-29477","pid":1200509,' +
  '"log":"/home/user/.ultron/bg-jobs/1788022610814662237-29477.log",' +
  '"exitFile":"/home/user/.ultron/bg-jobs/1788022610814662237-29477.exit","label":"sleep-build-stub"}';

// ---- parseStartedMarker -----------------------------------------------

test("parseStartedMarker: recognizes the marker when it is the whole string", () => {
  assert.deepEqual(parseStartedMarker(STARTED_JSON), {
    id: "1788022610814662237-29477",
    pid: 1200509,
    log: "/home/user/.ultron/bg-jobs/1788022610814662237-29477.log",
    exitFile: "/home/user/.ultron/bg-jobs/1788022610814662237-29477.exit",
    label: "sleep-build-stub",
  });
});

test("parseStartedMarker: recognizes the marker with a trailing newline (real printf output)", () => {
  assert.deepEqual(parseStartedMarker(STARTED_JSON + "\n"), {
    id: "1788022610814662237-29477",
    pid: 1200509,
    log: "/home/user/.ultron/bg-jobs/1788022610814662237-29477.log",
    exitFile: "/home/user/.ultron/bg-jobs/1788022610814662237-29477.exit",
    label: "sleep-build-stub",
  });
});

test("parseStartedMarker: text without the marker returns undefined", () => {
  assert.equal(parseStartedMarker("build ok\nexit 0"), undefined);
});

test("parseStartedMarker: JSON that looks similar but with ultron_bg other than \"started\" returns undefined", () => {
  assert.equal(parseStartedMarker('{"ultron_bg":"status","id":"x","done":true}'), undefined);
});

test("parseStartedMarker: missing required field (pid) returns undefined instead of throwing", () => {
  assert.equal(
    parseStartedMarker('{"ultron_bg":"started","id":"x","log":"a","exitFile":"b","label":"c"}'),
    undefined,
  );
});

test("parseStartedMarker: malformed (truncated) JSON returns undefined, doesn't throw", () => {
  assert.equal(parseStartedMarker('{"ultron_bg":"started","id":"x"'), undefined);
});

// ---- extractStartedJobFromEvent ----------------------------------------

function toolResultEvent(content: unknown): ClaudeEvent {
  return {
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content }] },
  };
}

test("extractStartedJobFromEvent: tool_result with string content (most common shape, confirmed against the real binary)", () => {
  const job = extractStartedJobFromEvent(toolResultEvent(STARTED_JSON));
  assert.equal(job?.id, "1788022610814662237-29477");
  assert.equal(job?.label, "sleep-build-stub");
});

test("extractStartedJobFromEvent: tool_result with content as an array of text blocks (alternative shape allowed by the API)", () => {
  const job = extractStartedJobFromEvent(toolResultEvent([{ type: "text", text: STARTED_JSON }]));
  assert.equal(job?.id, "1788022610814662237-29477");
});

test("extractStartedJobFromEvent: assistant event (not user/tool_result) returns undefined", () => {
  const event: ClaudeEvent = { type: "assistant", message: { content: [{ type: "text", text: STARTED_JSON }] } };
  assert.equal(extractStartedJobFromEvent(event), undefined);
});

test("extractStartedJobFromEvent: tool_result from another tool (without the marker) returns undefined", () => {
  assert.equal(extractStartedJobFromEvent(toolResultEvent("file.txt created")), undefined);
});

test("extractStartedJobFromEvent: user event without a content array (e.g. {}) doesn't throw", () => {
  const event: ClaudeEvent = { type: "user", message: {} };
  assert.equal(extractStartedJobFromEvent(event), undefined);
});

// ---- BackgroundJobTracker -----------------------------------------------

function withJobFiles(run: (dir: string, logPath: string, exitPath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "ultron-bgjobs-test-"));
  try {
    run(dir, join(dir, "job.log"), join(dir, "job.exit"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function startedEvent(id: string, log: string, exitFile: string, label = "test", pid = 12345): ClaudeEvent {
  return toolResultEvent(
    JSON.stringify({ ultron_bg: "started", id, pid, log, exitFile, label }),
  );
}

test("BackgroundJobTracker: job still without .exit doesn't fire onFinished and stays in the list", () => {
  withJobFiles((_dir, logPath, exitPath) => {
    writeFileSync(logPath, "running...\n");
    const finished: FinishedBackgroundJob[] = [];
    const tracker = new BackgroundJobTracker({ onFinished: (job) => finished.push(job) });
    tracker.observeEvent("sess-1", startedEvent("job-1", logPath, exitPath));
    tracker.pollOnce();
    assert.equal(finished.length, 0);
    assert.equal(tracker.listWatched().length, 1);
    tracker.stopPolling();
  });
});

test("BackgroundJobTracker: .exit appearing fires onFinished with exitCode and the log tail, and stops watching", () => {
  withJobFiles((_dir, logPath, exitPath) => {
    writeFileSync(logPath, "build ok\n");
    writeFileSync(exitPath, "0\n");
    const finished: FinishedBackgroundJob[] = [];
    const tracker = new BackgroundJobTracker({ onFinished: (job) => finished.push(job) });
    tracker.observeEvent("sess-1", startedEvent("job-1", logPath, exitPath, "my-build"));
    tracker.pollOnce();
    assert.equal(finished.length, 1);
    assert.equal(finished[0]?.exitCode, 0);
    assert.equal(finished[0]?.logTail, "build ok\n");
    assert.equal(finished[0]?.label, "my-build");
    assert.equal(finished[0]?.sessionId, "sess-1");
    assert.equal(tracker.listWatched().length, 0);
    tracker.stopPolling();
  });
});

test("BackgroundJobTracker: a non-zero exit code is also reported (not treated as a tracker failure)", () => {
  withJobFiles((_dir, logPath, exitPath) => {
    writeFileSync(logPath, "error: file not found\n");
    writeFileSync(exitPath, "1\n");
    const finished: FinishedBackgroundJob[] = [];
    const tracker = new BackgroundJobTracker({ onFinished: (job) => finished.push(job) });
    tracker.observeEvent("sess-1", startedEvent("job-1", logPath, exitPath));
    tracker.pollOnce();
    assert.equal(finished[0]?.exitCode, 1);
    tracker.stopPolling();
  });
});

test("BackgroundJobTracker: log tail respects logTailBytes (doesn't return the whole file)", () => {
  withJobFiles((_dir, logPath, exitPath) => {
    writeFileSync(logPath, "a".repeat(10_000));
    writeFileSync(exitPath, "0");
    const finished: FinishedBackgroundJob[] = [];
    const tracker = new BackgroundJobTracker({ onFinished: (job) => finished.push(job), logTailBytes: 100 });
    tracker.observeEvent("sess-1", startedEvent("job-1", logPath, exitPath));
    tracker.pollOnce();
    assert.equal(finished[0]?.logTail.length, 100);
    tracker.stopPolling();
  });
});

test("BackgroundJobTracker: the same id observed twice (duplicate event) doesn't become two watched jobs", () => {
  withJobFiles((_dir, logPath, exitPath) => {
    writeFileSync(logPath, "running...\n");
    const tracker = new BackgroundJobTracker({ onFinished: () => undefined });
    const event = startedEvent("job-1", logPath, exitPath);
    tracker.observeEvent("sess-1", event);
    tracker.observeEvent("sess-1", event);
    assert.equal(tracker.listWatched().length, 1);
    tracker.stopPolling();
  });
});

test("BackgroundJobTracker: a job that exceeds the observation ceiling (maxWatchMs) is dropped without firing onFinished", async () => {
  // Doesn't use `withJobFiles` here: needs to keep the directory alive across
  // a real `setTimeout` (the helper's synchronous cleanup in `finally` would
  // run before the poll, deleting the files too early).
  const dir = mkdtempSync(join(tmpdir(), "ultron-bgjobs-test-"));
  try {
    const logPath = join(dir, "job.log");
    const exitPath = join(dir, "job.exit");
    writeFileSync(logPath, "dev server running forever\n");
    // no .exit — never finishes, exactly the ceiling case

    const finished: FinishedBackgroundJob[] = [];
    const tracker = new BackgroundJobTracker({ onFinished: (job) => finished.push(job), maxWatchMs: 1 });
    tracker.observeEvent("sess-1", startedEvent("job-1", logPath, exitPath));
    assert.equal(tracker.listWatched().length, 1);

    // real wait to guarantee the 1ms ceiling has already passed before the poll
    // (without this, depending on machine timing, the test would be flaky).
    await new Promise((resolve) => setTimeout(resolve, 20));

    tracker.pollOnce();
    assert.equal(finished.length, 0);
    assert.equal(tracker.listWatched().length, 0);
    tracker.stopPolling();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("BackgroundJobTracker: two jobs from the same session are watched/completed independently", () => {
  withJobFiles((dir, _logPath, _exitPath) => {
    const logA = join(dir, "a.log");
    const exitA = join(dir, "a.exit");
    const logB = join(dir, "b.log");
    const exitB = join(dir, "b.exit");
    writeFileSync(logA, "a ok\n");
    writeFileSync(exitA, "0");
    writeFileSync(logB, "b running...\n");

    const finished: FinishedBackgroundJob[] = [];
    const tracker = new BackgroundJobTracker({ onFinished: (job) => finished.push(job) });
    tracker.observeEvent("sess-1", startedEvent("job-a", logA, exitA, "job-a"));
    tracker.observeEvent("sess-1", startedEvent("job-b", logB, exitB, "job-b"));
    tracker.pollOnce();

    assert.equal(finished.length, 1);
    assert.equal(finished[0]?.label, "job-a");
    assert.equal(tracker.listWatched().length, 1);
    assert.equal(tracker.listWatched()[0]?.label, "job-b");
    tracker.stopPolling();
  });
});

// ---- disk persistence (Phase F) --------------------------------------

test("BackgroundJobTracker: with persistPath, a watched job survives a new tracker (simulates a relay restart)", () => {
  withJobFiles((dir, logPath, exitPath) => {
    writeFileSync(logPath, "running...\n");
    const persistPath = join(dir, "watched.json");

    const trackerA = new BackgroundJobTracker({ onFinished: () => undefined, persistPath });
    trackerA.observeEvent("sess-1", startedEvent("job-1", logPath, exitPath, "survives-restart"));
    assert.equal(trackerA.listWatched().length, 1);
    trackerA.stopPolling();

    // "Relay restart": a NEW tracker, same persistPath — never saw the
    // start event, only what's left on disk.
    const finishedB: FinishedBackgroundJob[] = [];
    const trackerB = new BackgroundJobTracker({ onFinished: (job) => finishedB.push(job), persistPath });
    assert.equal(trackerB.listWatched().length, 1);
    assert.equal(trackerB.listWatched()[0]?.label, "survives-restart");
    assert.equal(trackerB.listWatched()[0]?.pid, 12345);

    // the job had actually already finished while tracker A "was down" —
    // trackerB needs to find this out without waiting for the normal poll.
    writeFileSync(exitPath, "0");
    trackerB.pollOnce();
    assert.equal(finishedB.length, 1);
    assert.equal(trackerB.listWatched().length, 0);
    trackerB.stopPolling();

    // the persistence file also reflects the completion (no ghost job left
    // that a THIRD restart would resurrect again).
    const persisted = JSON.parse(readFileSync(persistPath, "utf8")) as unknown[];
    assert.equal(persisted.length, 0);
  });
});

test("BackgroundJobTracker: without persistPath, behavior stays in-memory-only (no file created)", () => {
  withJobFiles((dir, logPath, exitPath) => {
    writeFileSync(logPath, "running...\n");
    const tracker = new BackgroundJobTracker({ onFinished: () => undefined });
    tracker.observeEvent("sess-1", startedEvent("job-1", logPath, exitPath));
    assert.equal(existsSync(join(dir, "watched.json")), false);
    tracker.stopPolling();
  });
});

test("BackgroundJobTracker: missing or corrupted persistPath starts empty, doesn't throw", () => {
  const dir = mkdtempSync(join(tmpdir(), "ultron-bgjobs-test-"));
  try {
    const missing = join(dir, "does-not-exist.json");
    const trackerMissing = new BackgroundJobTracker({ onFinished: () => undefined, persistPath: missing });
    assert.equal(trackerMissing.listWatched().length, 0);
    trackerMissing.stopPolling();

    const corrupted = join(dir, "corrupted.json");
    writeFileSync(corrupted, "this is not json{{{");
    const trackerCorrupted = new BackgroundJobTracker({ onFinished: () => undefined, persistPath: corrupted });
    assert.equal(trackerCorrupted.listWatched().length, 0);
    trackerCorrupted.stopPolling();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- cancel (Phase F) ------------------------------------------------------

test("BackgroundJobTracker: cancel really kills the process, removes it from the list and does NOT fire onFinished", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ultron-bgjobs-test-"));
  try {
    const logPath = join(dir, "job.log");
    const exitPath = join(dir, "job.exit");
    writeFileSync(logPath, "");

    // `detached: true` makes Node call `setsid()` on the child — same
    // topology as the real `ultron-bg` (the process's PID is already the
    // group's PGID/SID), so `process.kill(-pid, ...)` reaches it the same way.
    const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
    const pid = child.pid;
    assert.ok(pid, "spawn should have returned a PID");

    const finished: FinishedBackgroundJob[] = [];
    const tracker = new BackgroundJobTracker({ onFinished: (job) => finished.push(job) });
    tracker.observeEvent("sess-1", startedEvent("job-1", logPath, exitPath, "cancellable-sleep", pid));
    assert.equal(tracker.listWatched().length, 1);

    const ok = tracker.cancel("sess-1", "job-1");
    assert.equal(ok, true);
    assert.equal(tracker.listWatched().length, 0, "cancel should remove the job from the list immediately, without waiting for the process to die");

    await new Promise((resolve) => setTimeout(resolve, 500));
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    assert.equal(alive, false, "the real process should have been killed by cancel");
    assert.equal(finished.length, 0, "cancel should not fire onFinished — whoever cancelled it already knows it was cancelled");

    tracker.stopPolling();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("BackgroundJobTracker: cancelling an id that doesn't exist (or already finished) returns false without throwing", () => {
  const tracker = new BackgroundJobTracker({ onFinished: () => undefined });
  assert.equal(tracker.cancel("sess-1", "job-fantasma"), false);
  tracker.stopPolling();
});
