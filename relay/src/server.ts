import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { SessionManager } from "./sessionManager.js";

// Config via env — permite rodar uma instância por perfil (systemd,
// infra/systemd/) sem mudar código, igual o ttyd fazia (docs/08).
const PORT = Number(process.env.RELAY_PORT ?? 8765);
const HOST = process.env.RELAY_HOST ?? "127.0.0.1";
const HOME_OVERRIDE = process.env.RELAY_HOME_OVERRIDE;
const DEFAULT_SESSION = "default";

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

const sessionManager = new SessionManager(HOME_OVERRIDE);

const httpServer = createServer((req, res) => {
  if (req.url?.startsWith("/sessions")) {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.end(JSON.stringify({ sessions: sessionManager.listNames() }));
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
