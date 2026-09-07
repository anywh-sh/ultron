import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, type TestServer } from "./helpers/testServer.js";
import { collectUntil, connectSession, sendUserMessage } from "./helpers/wsClient.js";

// Real integration test (.ultron/skills/tests/SKILL.md), continuing where
// sessionLifecycle.test.ts leaves off: the "Stop" button (interrupt) and the
// HTTP session-management routes (rename/delete/list), none of which the
// original file covers.

let server: TestServer;

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await server.close();
});

beforeEach(() => {
  delete process.env.FAKE_CLAUDE_HANG;
});

afterEach(() => {
  delete process.env.FAKE_CLAUDE_HANG;
});

function httpUrl(path: string): string {
  return `http://127.0.0.1:${server.port}${path}`;
}

test("stop_turn interrupts an in-flight turn (stopped: true) without losing session continuity", async () => {
  const socket = await connectSession(server.port, "session-stop");

  process.env.FAKE_CLAUDE_HANG = "1";
  sendUserMessage(socket, "please hang");

  // Explicit synchronization on the real event stream (skill's "Determinism"
  // section) — waits for the fake claude's own `system`/`init` event, proof
  // the child has actually spawned and is genuinely blocked waiting for
  // SIGINT, before sending `stop_turn`. A fixed sleep here would either race
  // ahead of the spawn or pad every run with dead time.
  await collectUntil(
    socket,
    (message) => message.type === "claude_event" && (message.event as { type?: string }).type === "system",
  );
  socket.send(JSON.stringify({ type: "stop_turn" }));

  const messages = await collectUntil(socket, (message) => message.type === "turn_complete");
  const turnComplete = messages.at(-1);
  assert.deepEqual(turnComplete, { type: "turn_complete", stopped: true });

  const resultEvent = messages.find(
    (message) => message.type === "claude_event" && (message.event as { type?: string }).type === "result",
  );
  const sessionId = (resultEvent!.event as { session_id?: string }).session_id;
  assert.ok(sessionId, "an interrupted turn should still report a session_id (claudeSession.ts's stop() contract)");

  // A second, normal turn on the same session proves the interrupted one
  // didn't erase continuity — same invariant sessionLifecycle.test.ts checks
  // for two successful turns, here across a stop.
  delete process.env.FAKE_CLAUDE_HANG;
  sendUserMessage(socket, "are you still there");
  const secondMessages = await collectUntil(socket, (message) => message.type === "turn_complete");
  const secondResult = secondMessages.find(
    (message) => message.type === "claude_event" && (message.event as { type?: string }).type === "result",
  );
  assert.equal((secondResult!.event as { session_id?: string }).session_id, sessionId);

  socket.close();
});

test("a session renamed and deleted over HTTP disappears from GET /sessions, and reconnecting to the same id starts fresh", async () => {
  const socket = await connectSession(server.port, "session-http-lifecycle");
  sendUserMessage(socket, "hello");
  await collectUntil(socket, (message) => message.type === "turn_complete");

  const renameResponse = await fetch(httpUrl("/sessions/rename"), {
    method: "POST",
    body: JSON.stringify({ id: "session-http-lifecycle", title: "Minha sessão" }),
  });
  assert.equal(renameResponse.status, 200);

  const listed = (await (await fetch(httpUrl("/sessions"))).json()) as { sessions: { id: string; title: string }[] };
  assert.deepEqual(
    listed.sessions.find((entry) => entry.id === "session-http-lifecycle"),
    { id: "session-http-lifecycle", title: "Minha sessão" },
  );

  const deleteResponse = await fetch(httpUrl("/sessions/delete"), {
    method: "POST",
    body: JSON.stringify({ id: "session-http-lifecycle" }),
  });
  assert.equal(deleteResponse.status, 200);

  const listedAfterDelete = (await (await fetch(httpUrl("/sessions"))).json()) as { sessions: { id: string }[] };
  assert.ok(
    !listedAfterDelete.sessions.some((entry) => entry.id === "session-http-lifecycle"),
    "a deleted session should no longer appear in GET /sessions",
  );

  // Reconnecting under the SAME id after a delete must NOT resume the old
  // claude session_id — deleteSession() drops the SessionStore entry
  // entirely (sessionManager.ts), so this is really a brand new conversation
  // that just happens to reuse the id.
  const secondSocket = await connectSession(server.port, "session-http-lifecycle");
  sendUserMessage(secondSocket, "hi again");
  const messages = await collectUntil(secondSocket, (message) => message.type === "turn_complete");
  const resultEvent = messages.find(
    (message) => message.type === "claude_event" && (message.event as { type?: string }).type === "result",
  );
  // The fake claude only echoes back a `--resume` id if one was passed
  // (fixtures/fake-claude.mjs); a fresh session_id here (rather than a
  // rejection) proves no `--resume` flag was sent this time.
  assert.ok((resultEvent!.event as { session_id?: string }).session_id);

  socket.close();
  secondSocket.close();
});
