import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { startTestServer, type TestServer } from "./helpers/testServer.js";

// Real integration test (.ultron/skills/tests/SKILL.md): the embedded
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

function connectTerminal(chatSessionId: string, terminalId: string): Promise<WebSocket> {
  return new Promise((resolveConn, reject) => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${server.port}/terminal?session=${encodeURIComponent(chatSessionId)}&term=${encodeURIComponent(terminalId)}&cols=80&rows=24`,
    );
    socket.once("open", () => resolveConn(socket));
    socket.once("error", reject);
  });
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
function waitForQuiet(socket: WebSocket, quietMs = 300): Promise<void> {
  return new Promise((resolveQuiet) => {
    let timer: ReturnType<typeof setTimeout>;
    function onMessage(): void {
      clearTimeout(timer);
      timer = setTimeout(finish, quietMs);
    }
    function finish(): void {
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
  const marker1 = "ULTRON_TERM_TEST_MARKER_1";
  const marker2 = "ULTRON_TERM_TEST_MARKER_2";

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
    const marker3 = "ULTRON_TERM_TEST_FRESH_SHELL";
    sendInput(third, `echo ${marker3}\r`);
    const output = await waitForOutput(third, marker3);
    assert.ok(!output.includes(marker1), "a session killed via /terminals/close must not resurrect its old screen");
    third.close();
  } finally {
    await closeTerminal("term-chat-session", "tab-1");
  }
});
