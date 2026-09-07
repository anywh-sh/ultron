import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { detectDefaultModel, type DefaultModelInfo } from "./defaultModel.js";
import { listDirectories } from "./fsBrowse.js";
import { listFiles, readFileForViewer, resolveRawFile, type FilesError } from "./fsFiles.js";
import { FilesWatchSession } from "./fsWatch.js";
import { defaultCwd } from "./paths.js";
import { SessionManager } from "./sessionManager.js";
import { SessionStore, type ModelChoice, type PermissionMode } from "./sessionStore.js";
import { killAllTerminalsForSession, killTerminal, scrollTerminal, spawnTerminal } from "./terminalSession.js";
import { saveUpload } from "./uploads.js";

// Config via env — allows running one instance per profile (systemd,
// infra/systemd/) without changing code, same as ttyd used to do (docs/08).
const PORT = Number(process.env.RELAY_PORT ?? 8765);
const HOST = process.env.RELAY_HOST ?? "127.0.0.1";
const HOME_OVERRIDE = process.env.RELAY_HOME_OVERRIDE;
const DEFAULT_SESSION = "default";

// Same pattern as RELAY_UPLOAD_DIR: the two systemd services (personal/
// work) share WorkingDirectory, so a fixed relative path would collide
// between profiles — needs a dedicated env var in production. The
// "./sessions.local.json" fallback is only for local `npm run dev`.
const SESSIONS_FILE = process.env.RELAY_SESSIONS_FILE ?? "./sessions.local.json";

// Same reasoning as SESSIONS_FILE — docs/32 Phase F, persistence of the
// watched `ultron-bg` jobs (survives a relay restart).
const BACKGROUND_JOBS_FILE = process.env.RELAY_BACKGROUND_JOBS_FILE ?? "./background-jobs.local.json";

interface UserMessage {
  type: "user_message";
  text: string;
}

function isUserMessage(value: unknown): value is UserMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "user_message" &&
    typeof (value as { text?: unknown }).text === "string"
  );
}

function isStopTurnMessage(value: unknown): value is { type: "stop_turn" } {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "stop_turn";
}

/** Message edit (docs/33) — `fromEnd` counts from the end (`1` = the
 * user's last message). */
function isEditMessageMessage(value: unknown): value is { type: "edit_message"; fromEnd: number; text: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "edit_message" &&
    typeof (value as { fromEnd?: unknown }).fromEnd === "number" &&
    typeof (value as { text?: unknown }).text === "string"
  );
}

function isClearConversationMessage(value: unknown): value is { type: "clear_conversation" } {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "clear_conversation";
}

function isSetCwdMessage(value: unknown): value is { type: "set_cwd"; path: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "set_cwd" &&
    typeof (value as { path?: unknown }).path === "string"
  );
}

const PERMISSION_MODES: readonly PermissionMode[] = ["default", "acceptEdits", "plan", "bypassPermissions"];

function isSetPermissionModeMessage(value: unknown): value is { type: "set_permission_mode"; mode: PermissionMode } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "set_permission_mode" &&
    PERMISSION_MODES.includes((value as { mode?: unknown }).mode as PermissionMode)
  );
}

// No fixed enum here on purpose — the model catalog is now whatever the
// CLI's own `/model` probe reports (defaultModel.ts), which can grow without
// a relay change. A garbage value just makes the CLI itself reject the turn
// with its own error, same reasoning as the composer's `/model` parsing
// (client/src/lib/slashCommands.ts).
function isSetModelMessage(value: unknown): value is { type: "set_model"; model: ModelChoice } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "set_model" &&
    typeof (value as { model?: unknown }).model === "string" &&
    (value as { model: string }).model.length > 0
  );
}

function isRenameBody(value: unknown): value is { id: string; title: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { title?: unknown }).title === "string"
  );
}

function isIdBody(value: unknown): value is { id: string } {
  return typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string";
}

function isTerminalCloseBody(value: unknown): value is { session: string; term: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { session?: unknown }).session === "string" &&
    typeof (value as { term?: unknown }).term === "string"
  );
}

function isTerminalInputMessage(value: unknown): value is { type: "input"; data: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "input" &&
    typeof (value as { data?: unknown }).data === "string"
  );
}

/** Paginated history Phase 2 (docs/30) — request for turns older than the
 * initial tail, triggered by the user scrolling up in the UI. */
function isLoadOlderHistoryMessage(value: unknown): value is { type: "load_older_history"; beforeCursor: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "load_older_history" &&
    typeof (value as { beforeCursor?: unknown }).beforeCursor === "number"
  );
}

/** docs/32 Phase F — cancellation of an `ultron-bg` job requested by the UI. */
function isCancelBackgroundJobMessage(value: unknown): value is { type: "cancel_background_job"; id: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "cancel_background_job" &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

function isTerminalResizeMessage(value: unknown): value is { type: "resize"; cols: number; rows: number } {
  if (typeof value !== "object" || value === null || (value as { type?: unknown }).type !== "resize") return false;
  const cols = (value as { cols?: unknown }).cols;
  const rows = (value as { rows?: unknown }).rows;
  return typeof cols === "number" && cols > 0 && typeof rows === "number" && rows > 0;
}

/** Mouse wheel over the embedded terminal — see `scrollTerminal` in
 * terminalSession.ts for why this drives tmux's `copy-mode` directly instead
 * of just being handled by xterm.js locally. `lines` is signed: positive
 * scrolls up (older content), negative scrolls down. */
function statusForFilesError(error: FilesError): number {
  if (error === "permission_denied") return 403;
  if (error === "not_found") return 404;
  return 400; // invalid_path, outside_root
}

/** Work dir file panel's watch (docs/41 phase 5) — always the client's full
 * current set of visible dirs/files, never an incremental add/remove (see
 * `FilesWatchSession`). */
function isWatchMessage(value: unknown): value is { type: "watch"; dirs: string[]; files: string[] } {
  if (typeof value !== "object" || value === null || (value as { type?: unknown }).type !== "watch") return false;
  const dirs = (value as { dirs?: unknown }).dirs;
  const files = (value as { files?: unknown }).files;
  return Array.isArray(dirs) && dirs.every((d) => typeof d === "string") && Array.isArray(files) && files.every((f) => typeof f === "string");
}

function isTerminalScrollMessage(value: unknown): value is { type: "scroll"; lines: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "scroll" &&
    typeof (value as { lines?: unknown }).lines === "number"
  );
}

/** No body-parsing lib in the project (only the binary upload had a chunk
 * accumulator, `uploads.ts`) — the rename body is small enough (an id + a
 * title) that it doesn't justify pulling in a dependency just for this. */
function readJsonBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    req.on("error", reject);
  });
}

const sessionStore = new SessionStore(SESSIONS_FILE, defaultCwd(HOME_OVERRIDE));
const sessionManager = new SessionManager(HOME_OVERRIDE, sessionStore, BACKGROUND_JOBS_FILE);

// `true` from the first SIGTERM/SIGINT received onward — rejects a new turn
// (see `isUserMessage` above) while `gracefulShutdown` waits for turns
// already in progress to finish, see the definition at the end of the file.
let shuttingDown = false;

// Probing this profile's account default model (docs/28) — runs once at
// boot, in parallel with everything else (doesn't block `httpServer.listen`
// below). `defaultModelClients` covers the obvious race: the first client's
// WS connection almost always arrives before the probe resolves. Also
// carries the full model catalog (`available`) straight from the CLI's own
// usage text, replacing what used to be a hardcoded list.
let defaultModelInfo: DefaultModelInfo | undefined;
const defaultModelClients = new Set<WebSocket>();
detectDefaultModel(HOME_OVERRIDE, defaultCwd(HOME_OVERRIDE))
  .then((info) => {
    defaultModelInfo = info;
    if (!info) return;
    for (const client of defaultModelClients) {
      client.send(JSON.stringify({ type: "default_model_state", label: info.label, available: info.available }));
    }
  })
  .catch((error: unknown) => {
    console.error("[relay] failed to detect default model:", error);
  });

const httpServer = createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/sessions")) {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.end(JSON.stringify({ sessions: sessionManager.listTitled() }));
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/sessions/rename")) {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    readJsonBody(req)
      .then((body) => {
        const title = isRenameBody(body) ? body.title.trim() : "";
        if (!isRenameBody(body) || !title) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "id and a non-empty title are required" }));
          return;
        }
        const ok = sessionManager.renameTitle(body.id, title);
        if (!ok) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: "session not found" }));
          return;
        }
        res.end(JSON.stringify({ ok: true }));
      })
      .catch(() => {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "invalid body" }));
      });
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/sessions/delete")) {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    readJsonBody(req)
      .then((body) => {
        if (!isIdBody(body)) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "id is required" }));
          return;
        }
        const ok = sessionManager.deleteSession(body.id);
        if (!ok) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: "session not found" }));
          return;
        }
        // Sweeps and kills any terminal (tmux) this chat session still had
        // open — without this it would stay orphaned forever, with no tab in
        // the UI aware it exists (see terminalSession.ts).
        killAllTerminalsForSession(PORT, body.id)
          .catch((error: unknown) => console.error("[relay] failed to clean up terminals for deleted session:", error))
          .finally(() => res.end(JSON.stringify({ ok: true })));
      })
      .catch(() => {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "invalid body" }));
      });
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/terminals/close")) {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    readJsonBody(req)
      .then((body) => {
        if (!isTerminalCloseBody(body)) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "session and term are required" }));
          return;
        }
        killTerminal(PORT, body.session, body.term)
          .then(() => res.end(JSON.stringify({ ok: true })))
          .catch((error: unknown) => {
            console.error("[relay] failed to close terminal:", error);
            res.writeHead(500);
            res.end(JSON.stringify({ error: "failed to close terminal" }));
          });
      })
      .catch(() => {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "invalid body" }));
      });
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/fs/list")) {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const requestedPath = url.searchParams.get("path");
    const result = listDirectories(requestedPath ?? defaultCwd(HOME_OVERRIDE));
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (!result.ok) {
      const status = result.error === "permission_denied" ? 403 : result.error === "not_found" ? 404 : 400;
      res.writeHead(status);
      res.end(JSON.stringify({ error: result.error }));
      return;
    }
    res.end(JSON.stringify({ path: result.path, entries: result.entries }));
    return;
  }

  // Work dir file panel (docs/41) — list/read/raw are all rooted at the
  // requesting session's own cwd (`sessionStore.getCwdState`), never a path
  // the client supplies directly; the client only ever sends `session=<id>`
  // plus a path already confirmed to live under that root by a previous
  // response.
  if (req.method === "GET" && req.url?.startsWith("/files/list")) {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const sessionId = url.searchParams.get("session")?.trim() || DEFAULT_SESSION;
    const rawPath = url.searchParams.get("path");
    const showHidden = url.searchParams.get("all") === "1";
    const root = sessionStore.getCwdState(sessionId).cwd;
    const result = listFiles(root, rawPath, showHidden);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (!result.ok) {
      res.writeHead(statusForFilesError(result.error));
      res.end(JSON.stringify({ error: result.error }));
      return;
    }
    res.end(JSON.stringify({ root: result.root, path: result.path, entries: result.entries }));
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/files/read")) {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const sessionId = url.searchParams.get("session")?.trim() || DEFAULT_SESSION;
    const rawPath = url.searchParams.get("path");
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (!rawPath) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "invalid_path" }));
      return;
    }
    const root = sessionStore.getCwdState(sessionId).cwd;
    const result = readFileForViewer(root, rawPath);
    if (!result.ok) {
      res.writeHead(statusForFilesError(result.error));
      res.end(JSON.stringify({ error: result.error }));
      return;
    }
    const body =
      result.kind === "text"
        ? { kind: "text", path: result.path, content: result.content, size: result.size, mtimeMs: result.mtimeMs, truncated: result.truncated }
        : result.kind === "image"
          ? { kind: "image", path: result.path, size: result.size, mtimeMs: result.mtimeMs, mime: result.mime }
          : { kind: "binary", path: result.path, size: result.size, mtimeMs: result.mtimeMs };
    res.end(JSON.stringify(body));
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/files/raw")) {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const sessionId = url.searchParams.get("session")?.trim() || DEFAULT_SESSION;
    const rawPath = url.searchParams.get("path");
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (!rawPath) {
      res.writeHead(400);
      res.end();
      return;
    }
    const root = sessionStore.getCwdState(sessionId).cwd;
    const result = resolveRawFile(root, rawPath);
    if (!result.ok) {
      res.writeHead(statusForFilesError(result.error));
      res.end();
      return;
    }
    res.setHeader("Content-Type", result.mime);
    createReadStream(result.path).on("error", () => res.end()).pipe(res);
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/upload")) {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const ext = url.searchParams.get("ext") ?? "bin";
    saveUpload(req, ext)
      .then((result) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.end(JSON.stringify(result));
      })
      .catch((error: unknown) => {
        console.error("[relay] upload failed:", error);
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.writeHead(500);
        res.end(String(error instanceof Error ? error.message : error));
      });
    return;
  }

  res.writeHead(426);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });

httpServer.listen(PORT, HOST, () => {
  console.log(`[relay] listening on ws://${HOST}:${PORT}`, HOME_OVERRIDE ? `(HOME=${HOME_OVERRIDE})` : "");
});

/** One interactive shell (tmux) per terminal tab — its own protocol, much
 * simpler than the chat's (no history replay: reattaching to tmux already
 * redraws the screen on its own, see terminalSession.ts). Closing the WS
 * connection (tab/session switch, panel closed, or network drop) only
 * detaches — it never kills the tmux session from here; actually killing it
 * only happens via `POST /terminals/close` (tab explicitly closed) or when
 * the whole chat session is deleted. */
function handleTerminalConnection(socket: WebSocket, url: URL): void {
  const chatSessionId = url.searchParams.get("session")?.trim() || DEFAULT_SESSION;
  const terminalId = url.searchParams.get("term")?.trim();
  if (!terminalId) {
    socket.close();
    return;
  }
  const cols = Number(url.searchParams.get("cols"));
  const rows = Number(url.searchParams.get("rows"));

  const cwd = sessionStore.getCwdState(chatSessionId).cwd;
  const term = spawnTerminal({
    homeOverride: HOME_OVERRIDE,
    relayPort: PORT,
    chatSessionId,
    terminalId,
    cwd,
    cols: Number.isFinite(cols) && cols > 0 ? Math.floor(cols) : 80,
    rows: Number.isFinite(rows) && rows > 0 ? Math.floor(rows) : 24,
  });

  const dataSub = term.onData((data) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: "data", data }));
  });
  const exitSub = term.onExit(({ exitCode }) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: "exit", code: exitCode }));
  });

  socket.on("message", (raw: Buffer) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return;
    }
    try {
      if (isTerminalInputMessage(parsed)) {
        term.write(parsed.data);
      } else if (isTerminalResizeMessage(parsed)) {
        term.resize(Math.floor(parsed.cols), Math.floor(parsed.rows));
      } else if (isTerminalScrollMessage(parsed)) {
        scrollTerminal(PORT, chatSessionId, terminalId, Math.trunc(parsed.lines));
      }
    } catch (error) {
      // `term.write`/`term.resize` call ioctl on the pty's fd under the
      // hood — a real finding from running the app: a message in transit
      // (e.g. a debounced resize) can arrive after the pty has already died
      // (the socket's `close` already ran `term.kill()`, or the process
      // exited on its own), throwing a synchronous exception (`EBADF`).
      // Without this try/catch, this wouldn't stay contained to this
      // terminal tab — it would take down the WHOLE relay process (an
      // uncaught exception inside an EventEmitter's handler), along with
      // every chat session connected to it. Dropping the message is safe:
      // the terminal client will reconnect on its own if the pty really did die.
      console.error("[relay] discarding terminal message, pty possibly already dead:", error);
    }
  });

  socket.on("close", () => {
    dataSub.dispose();
    exitSub.dispose();
    term.kill();
  });
}

/** Work dir file panel's watch (docs/41 phase 5) — same lifecycle as
 * `/terminal`: connects while the pane is mounted (tab active AND pane
 * open), disconnects on tab switch/pane close/session change. The relay
 * keeps no watcher registry beyond this one connection's own
 * `FilesWatchSession` — everything it opened dies with the socket. */
function handleFilesConnection(socket: WebSocket, url: URL): void {
  const chatSessionId = url.searchParams.get("session")?.trim() || DEFAULT_SESSION;
  const root = sessionStore.getCwdState(chatSessionId).cwd;

  const watchSession = new FilesWatchSession(root, (message) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  });

  socket.on("message", (raw: Buffer) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (isWatchMessage(parsed)) watchSession.update(parsed.dirs, parsed.files);
  });

  socket.on("close", () => {
    watchSession.close();
  });
}

wss.on("connection", (socket: WebSocket, request) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (url.pathname === "/terminal") {
    handleTerminalConnection(socket, url);
    return;
  }

  if (url.pathname === "/files") {
    handleFilesConnection(socket, url);
    return;
  }

  const sessionId = url.searchParams.get("session")?.trim() || DEFAULT_SESSION;

  console.log(`[relay] client connected (session: ${sessionId})`);
  const session = sessionManager.getOrCreate(sessionId);
  session.addClient(socket);

  defaultModelClients.add(socket);
  if (defaultModelInfo) {
    socket.send(
      JSON.stringify({ type: "default_model_state", label: defaultModelInfo.label, available: defaultModelInfo.available }),
    );
  }

  socket.on("message", (raw: Buffer) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (isStopTurnMessage(parsed)) {
      session.stopTurn();
      return;
    }
    if (isClearConversationMessage(parsed)) {
      session.clearConversation();
      return;
    }
    if (isSetCwdMessage(parsed)) {
      const result = session.setCwd(parsed.path);
      if (!result.ok) socket.send(JSON.stringify({ type: "set_cwd_error", message: result.error }));
      return;
    }
    if (isSetPermissionModeMessage(parsed)) {
      session.setPermissionMode(parsed.mode);
      return;
    }
    if (isSetModelMessage(parsed)) {
      session.setModel(parsed.model);
      return;
    }
    if (isLoadOlderHistoryMessage(parsed)) {
      session.loadOlderHistory(socket, parsed.beforeCursor);
      return;
    }
    if (isCancelBackgroundJobMessage(parsed)) {
      session.cancelBackgroundJob(parsed.id);
      return;
    }
    if (isEditMessageMessage(parsed)) {
      if (shuttingDown) {
        socket.send(JSON.stringify({ type: "edit_message_error", message: "relay reiniciando, tente de novo em instantes" }));
        return;
      }
      session.editMessage(socket, parsed.fromEnd, parsed.text);
      return;
    }
    if (!isUserMessage(parsed)) {
      console.warn("[relay] message ignored, unexpected format:", parsed);
      return;
    }
    if (shuttingDown) {
      socket.send(JSON.stringify({ type: "turn_error", message: "relay reiniciando, tente de novo em instantes" }));
      return;
    }
    session.submitTurn(socket, parsed.text);
  });

  socket.on("close", () => {
    session.removeClient(socket);
    defaultModelClients.delete(socket);
    console.log(`[relay] client disconnected (session: ${sessionId})`);
  });
});

// How long to wait for turn(s) in progress to finish on their own before
// giving up and aborting via SIGINT (see below) — generous on purpose
// (long responses exist), but configurable so adjusting it doesn't require
// a rebuild. The systemd unit's `TimeoutStopSec` needs to stay GREATER than
// this + `SHUTDOWN_ABORT_GRACE_MS`, otherwise systemd sends SIGKILL to the
// whole cgroup before we even finish waiting.
const SHUTDOWN_GRACE_MS = Number(process.env.RELAY_SHUTDOWN_GRACE_MS ?? 4 * 60 * 1000);
// After the fallback SIGINT (same path as the "Stop" button — tested
// against the real binary, exits cleanly with a valid `result`), how long
// to wait for the `claude -p` process to actually finish before exiting anyway.
const SHUTDOWN_ABORT_GRACE_MS = 10_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * SIGTERM (`systemctl restart`/`stop`) or SIGINT (Ctrl+C in dev) — by
 * default systemd (`KillMode=control-group`, deliberately not used here,
 * see infra/systemd/) would send the signal to the child `claude -p`
 * process at the same time as the relay, killing a turn in progress raw
 * (only the SIGINT sent by the "Stop" button was validated as a clean exit,
 * not SIGTERM). With `KillMode=mixed` on the unit, only the relay receives
 * the signal — this function stops accepting new connections and new
 * turns, waits for turns already in progress to finish on their own, and
 * only resorts to SIGINT (`stopTurn`, same path as the "Stop" button) if
 * one gets stuck past the grace period.
 */
async function gracefulShutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[relay] ${signal} received — no longer accepting new connections, waiting for turn(s) in progress...`);
  httpServer.close();

  const idle = sessionManager.waitForAllIdle();
  const timedOut = await Promise.race([idle.then(() => false), delay(SHUTDOWN_GRACE_MS).then(() => true)]);

  if (timedOut) {
    console.warn(
      `[relay] turn(s) still in progress after ${SHUTDOWN_GRACE_MS}ms — aborting with SIGINT (same path as the "Stop" button) before exiting.`,
    );
    sessionManager.stopAllTurns();
    await Promise.race([idle, delay(SHUTDOWN_ABORT_GRACE_MS)]);
  }

  console.log("[relay] exiting.");
  process.exit(0);
}

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
