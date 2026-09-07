import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { CHOICE_ALLOWED_TOOL, McpChoiceBridge, type ChoiceAnswer, type ChoiceQuestion } from "./mcpBridge.js";

/** Minimal fakes for the two Node HTTP objects `handleRequest` touches — no
 * real socket needed, `readJsonBody` only uses the `data`/`end`/`error`
 * events. Safe to `emit` right after calling `handleRequest` (not after
 * `await`ing it): an async function runs synchronously up to its first
 * `await`, and `readJsonBody`'s `req.on(...)` calls all happen before that
 * point, so the listeners are already attached by the time `handleRequest`
 * yields control back to the caller. */
function fakeRequest(body: unknown, method = "POST"): IncomingMessage & EventEmitter {
  const req = new EventEmitter() as IncomingMessage & EventEmitter;
  req.method = method;
  queueMicrotask(() => {
    req.emit("data", Buffer.from(JSON.stringify(body)));
    req.emit("end");
  });
  return req;
}

interface FakeResponseState {
  writableEnded: boolean;
  destroyed: boolean;
  status?: number;
  body?: string;
}

/** Returns the mutable `state` separately from the `ServerResponse`-typed
 * `res` passed to `handleRequest` — `writableEnded`/`destroyed` are readonly
 * on the real type, so a test that needs to flip them (simulating the
 * connection dying mid-wait) mutates `state` directly instead of casting
 * around TS. Both views share the same underlying data. */
function fakeResponse(): { res: ServerResponse; state: FakeResponseState } {
  const state: FakeResponseState = { writableEnded: false, destroyed: false };
  const res = {
    get writableEnded() {
      return state.writableEnded;
    },
    get destroyed() {
      return state.destroyed;
    },
    writeHead(status: number) {
      state.status = status;
      return res;
    },
    end(chunk?: string) {
      state.writableEnded = true;
      if (chunk !== undefined) state.body = chunk;
    },
  } as unknown as ServerResponse;
  return { res, state };
}

function parsedBody(state: FakeResponseState): { id?: unknown; result?: Record<string, unknown> } {
  return JSON.parse(state.body ?? "{}") as { id?: unknown; result?: Record<string, unknown> };
}

test("unknown token: 404, never reaches any host", async () => {
  const bridge = new McpChoiceBridge();
  const { res, state } = fakeResponse();
  await bridge.handleRequest("no-such-token", fakeRequest({ method: "tools/list", id: 1 }), res);
  assert.equal(state.status, 404);
});

test("non-POST: 405", async () => {
  const bridge = new McpChoiceBridge();
  const { token } = bridge.registerTurn({ presentChoice: async () => [] });
  const { res, state } = fakeResponse();
  await bridge.handleRequest(token, fakeRequest({}, "GET"), res);
  assert.equal(state.status, 405);
});

test("initialize: echoes the client's protocolVersion, reports the tool capability", async () => {
  const bridge = new McpChoiceBridge();
  const { token } = bridge.registerTurn({ presentChoice: async () => [] });
  const { res, state } = fakeResponse();
  await bridge.handleRequest(token, fakeRequest({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2099-01-01" } }), res);
  const body = parsedBody(state);
  assert.equal(body.id, 0);
  assert.equal((body.result as { protocolVersion?: string }).protocolVersion, "2099-01-01");
  assert.deepEqual((body.result as { capabilities?: unknown }).capabilities, { tools: {} });
});

test("notifications/initialized (no id): 202, empty body — never touches the host", async () => {
  const bridge = new McpChoiceBridge();
  const { token } = bridge.registerTurn({ presentChoice: async () => [] });
  const { res, state } = fakeResponse();
  await bridge.handleRequest(token, fakeRequest({ jsonrpc: "2.0", method: "notifications/initialized" }), res);
  assert.equal(state.status, 202);
  assert.equal(state.body, undefined);
});

test("tools/list: exposes exactly the present_choice tool, matching CHOICE_ALLOWED_TOOL's name", async () => {
  const bridge = new McpChoiceBridge();
  const { token } = bridge.registerTurn({ presentChoice: async () => [] });
  const { res, state } = fakeResponse();
  await bridge.handleRequest(token, fakeRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }), res);
  const body = parsedBody(state);
  const tools = (body.result as { tools?: { name: string }[] }).tools ?? [];
  assert.equal(tools.length, 1);
  assert.equal(`mcp__ultron-choice__${tools[0].name}`, CHOICE_ALLOWED_TOOL);
});

test("tools/call present_choice: forwards questions to the host, returns its answers as JSON text", async () => {
  const bridge = new McpChoiceBridge();
  const questions: ChoiceQuestion[] = [{ question: "SQLite or Postgres?", options: [{ label: "SQLite" }, { label: "Postgres" }] }];
  const answers: ChoiceAnswer[] = [{ question: questions[0].question, selected: ["SQLite"] }];
  let receivedQuestions: ChoiceQuestion[] | undefined;
  const { token } = bridge.registerTurn({
    presentChoice: async (q) => {
      receivedQuestions = q;
      return answers;
    },
  });
  const { res, state } = fakeResponse();
  await bridge.handleRequest(
    token,
    fakeRequest({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "present_choice", arguments: { questions } } }),
    res,
  );
  assert.deepEqual(receivedQuestions, questions);
  const body = parsedBody(state);
  const content = (body.result as { content?: { type: string; text: string }[] }).content ?? [];
  assert.deepEqual(JSON.parse(content[0].text), { answers });
});

test("tools/call present_choice: a host that never resolves genuinely blocks the response (no timeout of our own)", async () => {
  const bridge = new McpChoiceBridge();
  let releaseHost: (() => void) | undefined;
  const { token } = bridge.registerTurn({
    presentChoice: () =>
      new Promise((resolve) => {
        releaseHost = () => resolve([]);
      }),
  });
  const { res, state } = fakeResponse();
  const pending = bridge.handleRequest(
    token,
    fakeRequest({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "present_choice", arguments: { questions: [] } } }),
    res,
  );
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(state.writableEnded, false, "must still be waiting — no response written yet");
  releaseHost?.();
  await pending;
  assert.equal(state.writableEnded, true);
});

test("resolving after the connection already ended (turn interrupted mid-wait, docs/46) doesn't throw or double-write", async () => {
  const bridge = new McpChoiceBridge();
  let releaseHost: (() => void) | undefined;
  const { token } = bridge.registerTurn({
    presentChoice: () =>
      new Promise((resolve) => {
        releaseHost = () => resolve([]);
      }),
  });
  const { res, state } = fakeResponse();
  const pending = bridge.handleRequest(
    token,
    fakeRequest({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "present_choice", arguments: { questions: [] } } }),
    res,
  );
  await new Promise((r) => setTimeout(r, 20));
  // Simulates the client's HTTP connection dying (e.g. the `claude` child
  // got SIGINT'd) before the human ever answered.
  state.writableEnded = true;
  assert.doesNotThrow(() => releaseHost?.());
  await pending;
  assert.equal(state.body, undefined, "sendJson must have no-op'd, not tried to write to the dead connection");
});

test("unrecognized method with an id: empty result instead of hanging or erroring (e.g. the server/discover preflight)", async () => {
  const bridge = new McpChoiceBridge();
  const { token } = bridge.registerTurn({ presentChoice: async () => [] });
  const { res, state } = fakeResponse();
  await bridge.handleRequest(token, fakeRequest({ jsonrpc: "2.0", id: 5, method: "server/discover" }), res);
  const body = parsedBody(state);
  assert.equal(body.id, 5);
  assert.deepEqual(body.result, {});
});
