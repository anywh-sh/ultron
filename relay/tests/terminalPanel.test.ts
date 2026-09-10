import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { startTestServer, type TestServer } from "./helpers/testServer.js";
import { connectSession } from "./helpers/wsClient.js";

// Real integration test (.anywh/skills/tests/SKILL.md): the embedded
// terminal panel talks to a REAL tmux session via node-pty
// (relay/src/terminalSession.ts) — nothing to fake here, tmux is a real
// system dependency the sandbox already has (unlike `claude`, it's
// deterministic and instant, so there's no reason to substitute it).

let server: TestServer;

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await server.close();
});

function connectTerminal(chatSessionId: string, terminalId: string, cwd?: string): Promise<WebSocket> {
  return new Promise((resolveConn, reject) => {
    let url = `ws://127.0.0.1:${server.port}/terminal?session=${encodeURIComponent(chatSessionId)}&term=${encodeURIComponent(terminalId)}&cols=80&rows=24`;
    if (cwd) url += `&cwd=${encodeURIComponent(cwd)}`;
    const socket = new WebSocket(url);
    socket.once("open", () => resolveConn(socket));
    socket.once("error", reject);
  });
}

/** Sets the chat session's own cwd (same `set_cwd`/`cwd_state` handshake
 * `fileBrowser.test.ts` uses) — `/terminal`'s own `cwd` query param
 * (file tree's "open in terminal") is confined to this root, the same
 * contract `/files/*` already has (`resolveWithinRoot`, fsFiles.ts). */
async function setSessionCwd(chatSessionId: string, cwd: string): Promise<WebSocket> {
  const socket = await connectSession(server.port, chatSessionId);
  socket.send(JSON.stringify({ type: "set_cwd", path: cwd }));
  await new Promise<void>((resolveCwd) => {
    function onMessage(raw: Buffer): void {
      const message = JSON.parse(raw.toString()) as { type: string; cwd?: string };
      if (message.type === "cwd_state" && message.cwd === cwd) {
        socket.off("message", onMessage);
        resolveCwd();
      }
    }
    socket.on("message", onMessage);
  });
  return socket;
}

/** Accumulates every `{"type":"data",...}` frame's payload until the
 * running total contains `needle` — explicit synchronization on the real
 * pty output stream (skill's "Determinism" section), not a fixed sleep: a
 * real shell's prompt/echo timing varies run to run. */
function waitForOutput(socket: WebSocket, needle: string, timeoutMs = 5000): Promise<string> {
  return new Promise((resolveWait, reject) => {
    let buffer = "";
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error(`waitForOutput timed out waiting for ${JSON.stringify(needle)}, got so far: ${JSON.stringify(buffer)}`));
    }, timeoutMs);

    function onMessage(raw: Buffer): void {
      const message = JSON.parse(raw.toString()) as { type: string; data?: string };
      if (message.type === "data" && message.data) buffer += message.data;
      if (buffer.includes(needle)) {
        clearTimeout(timeout);
        socket.off("message", onMessage);
        resolveWait(buffer);
      }
    }

    socket.on("message", onMessage);
  });
}

function sendInput(socket: WebSocket, data: string): void {
  socket.send(JSON.stringify({ type: "input", data }));
}

/** Real finding building this test: `spawnTerminal` chains `new-session -A`
 * with two more `set-option` commands as separate tmux "command mode" calls
 * in the same argv (see the comment on `spawnTerminal`) — tmux redraws the
 * whole screen more than once while working through that chain right after
 * attaching, and keystrokes sent to the client while it's mid-chain (still
 * flipping between command mode and "forward keys to the pane") can be
 * swallowed instead of reaching the shell. Waiting for a quiet period (no
 * new `data` frames) before typing is what a real user effectively does too
 * — they don't start typing into a still-redrawing terminal. */
// `maxWaitMs` is a hard ceiling on top of the quiet-period logic above, not
// just this function's own timeout — a real incident running this suite in
// CI (2026-09-07): on a slower/jitterier runner, tmux's redraw chatter never
// left a genuine `quietMs` gap, so the unbounded version of this function
// hung forever waiting for silence that never came, which hung the entire
// `npm run test:all` job (and, by extension, every other test file queued
// behind it) for over an hour before it was manually cancelled. A gap this
// wide is unusual enough on its own to be worth surfacing as a failure
// rather than silently proceeding to type into a possibly-still-redrawing
// terminal, so this rejects instead of resolving once the ceiling is hit.
function waitForQuiet(socket: WebSocket, quietMs = 300, maxWaitMs = 4000): Promise<void> {
  return new Promise((resolveQuiet, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const ceiling = setTimeout(() => {
      socket.off("message", onMessage);
      clearTimeout(timer);
      reject(new Error(`waitForQuiet: terminal never went quiet for ${String(quietMs)}ms within ${String(maxWaitMs)}ms`));
    }, maxWaitMs);
    function onMessage(): void {
      clearTimeout(timer);
      timer = setTimeout(finish, quietMs);
    }
    function finish(): void {
      clearTimeout(ceiling);
      socket.off("message", onMessage);
      resolveQuiet();
    }
    socket.on("message", onMessage);
    timer = setTimeout(finish, quietMs);
  });
}

async function closeTerminal(chatSessionId: string, terminalId: string): Promise<void> {
  await fetch(`http://127.0.0.1:${server.port}/terminals/close`, {
    method: "POST",
    body: JSON.stringify({ session: chatSessionId, term: terminalId }),
  });
}

test("a terminal tab runs real shell commands, and its tmux session survives a disconnect/reconnect (unlike a plain pty)", async () => {
  const marker1 = "ANYWH_TERM_TEST_MARKER_1";
  const marker2 = "ANYWH_TERM_TEST_MARKER_2";

  // `finally`-cleaned up unconditionally: a WS `close()` only detaches (by
  // design, see terminalSession.ts's top-of-file comment), it never kills
  // the underlying tmux session — without an explicit `/terminals/close`
  // at the end, every run of this test would leave a REAL tmux server
  // process behind on whatever machine runs it (a real finding while
  // writing this test: three manual reruns left three live orphaned tmux
  // servers on this very sandbox).
  try {
    const first = await connectTerminal("term-chat-session", "tab-1");
    await waitForQuiet(first);
    sendInput(first, `echo ${marker1}\r`);
    await waitForOutput(first, marker1);
    first.close();

    // Reconnecting to the SAME chat session + terminal id must reattach to
    // the SAME tmux session (spawnTerminal's `new-session -A`, not a fresh
    // one) — tmux redraws its whole current screen on reattach, so the
    // first marker (still on screen, unlike scrollback) must show up again
    // without this connection ever having sent it.
    const second = await connectTerminal("term-chat-session", "tab-1");
    await waitForOutput(second, marker1);
    await waitForQuiet(second);
    sendInput(second, `echo ${marker2}\r`);
    await waitForOutput(second, marker2);
    second.close();

    // Explicitly closing the tab (POST /terminals/close) genuinely kills
    // the tmux session, unlike a WS disconnect (which only detaches) — a
    // THIRD connection to the same ids must start a brand new shell with
    // neither marker anywhere on its freshly drawn screen.
    const closeResponse = await fetch(`http://127.0.0.1:${server.port}/terminals/close`, {
      method: "POST",
      body: JSON.stringify({ session: "term-chat-session", term: "tab-1" }),
    });
    assert.equal(closeResponse.status, 200);

    const third = await connectTerminal("term-chat-session", "tab-1");
    await waitForQuiet(third);
    const marker3 = "ANYWH_TERM_TEST_FRESH_SHELL";
    sendInput(third, `echo ${marker3}\r`);
    const output = await waitForOutput(third, marker3);
    assert.ok(!output.includes(marker1), "a session killed via /terminals/close must not resurrect its old screen");
    third.close();
  } finally {
    await closeTerminal("term-chat-session", "tab-1");
  }
});

test("a cwd query param starts the shell there — the file tree's \"open in terminal\"", async () => {
  const workDir = realpathSync(mkdtempSync(join(tmpdir(), "anywh-terminal-cwd-")));
  const subDir = join(workDir, "sub");
  mkdirSync(subDir);
  const chatSessionId = "term-chat-session-cwd";
  const chatSocket = await setSessionCwd(chatSessionId, workDir);

  try {
    const socket = await connectTerminal(chatSessionId, "tab-cwd", subDir);
    await waitForQuiet(socket);
    sendInput(socket, "pwd\r");
    const output = await waitForOutput(socket, subDir);
    assert.ok(output.includes(subDir));
    socket.close();
  } finally {
    await closeTerminal(chatSessionId, "tab-cwd");
    chatSocket.close();
  }
});

test("a cwd outside the session's own root is ignored, falling back to the session's cwd", async () => {
  const workDir = realpathSync(mkdtempSync(join(tmpdir(), "anywh-terminal-cwd-root-")));
  const outsideDir = realpathSync(mkdtempSync(join(tmpdir(), "anywh-terminal-cwd-outside-")));
  const chatSessionId = "term-chat-session-cwd-outside";
  const chatSocket = await setSessionCwd(chatSessionId, workDir);

  try {
    const socket = await connectTerminal(chatSessionId, "tab-cwd-outside", outsideDir);
    await waitForQuiet(socket);
    sendInput(socket, "pwd\r");
    const output = await waitForOutput(socket, workDir);
    assert.ok(output.includes(workDir));
    assert.ok(!output.includes(outsideDir), "a cwd outside the session's root must never be honored");
    socket.close();
  } finally {
    await closeTerminal(chatSessionId, "tab-cwd-outside");
    chatSocket.close();
  }
});
