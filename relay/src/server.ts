import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { listDirectories } from "./fsBrowse.js";
import { defaultCwd } from "./paths.js";
import { SessionManager } from "./sessionManager.js";
import { SessionStore } from "./sessionStore.js";
import { saveUpload } from "./uploads.js";

// Config via env — permite rodar uma instância por perfil (systemd,
// infra/systemd/) sem mudar código, igual o ttyd fazia (docs/08).
const PORT = Number(process.env.RELAY_PORT ?? 8765);
const HOST = process.env.RELAY_HOST ?? "127.0.0.1";
const HOME_OVERRIDE = process.env.RELAY_HOME_OVERRIDE;
const DEFAULT_SESSION = "default";

// Mesmo padrão do RELAY_UPLOAD_DIR: os dois serviços systemd (pessoal/
// trabalho) compartilham WorkingDirectory, então um caminho relativo fixo
// colidiria entre perfis — precisa de env var dedicada em produção. O
// fallback "./sessions.local.json" é só pra `npm run dev` local.
const SESSIONS_FILE = process.env.RELAY_SESSIONS_FILE ?? "./sessions.local.json";

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

function isSetCwdMessage(value: unknown): value is { type: "set_cwd"; path: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "set_cwd" &&
    typeof (value as { path?: unknown }).path === "string"
  );
}

const sessionStore = new SessionStore(SESSIONS_FILE, defaultCwd(HOME_OVERRIDE));
const sessionManager = new SessionManager(HOME_OVERRIDE, sessionStore);

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
    res.end(JSON.stringify({ sessions: sessionManager.listNames() }));
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

  if (req.method === "POST" && req.url?.startsWith("/upload")) {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const ext = url.searchParams.get("ext") ?? "bin";
    saveUpload(req, ext)
      .then((path) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.end(JSON.stringify({ path }));
      })
      .catch((error: unknown) => {
        console.error("[relay] falha no upload:", error);
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

wss.on("connection", (socket: WebSocket, request) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const sessionName = url.searchParams.get("session")?.trim() || DEFAULT_SESSION;

  console.log(`[relay] client connected (session: ${sessionName})`);
  const session = sessionManager.getOrCreate(sessionName);
  session.addClient(socket);

  socket.on("message", (raw: Buffer) => {
    const parsed: unknown = JSON.parse(raw.toString());
    if (isStopTurnMessage(parsed)) {
      session.stopTurn();
      return;
    }
    if (isSetCwdMessage(parsed)) {
      const result = session.setCwd(parsed.path);
      if (!result.ok) socket.send(JSON.stringify({ type: "set_cwd_error", message: result.error }));
      return;
    }
    if (!isUserMessage(parsed)) {
      console.warn("[relay] mensagem ignorada, formato inesperado:", parsed);
      return;
    }
    session.submitTurn(parsed.text);
  });

  socket.on("close", () => {
    session.removeClient(socket);
    console.log(`[relay] client disconnected (session: ${sessionName})`);
  });
});
