import { WebSocketServer, type WebSocket } from "ws";
import { ClaudeSession } from "./claudeSession.js";

// Protótipo do relay (milestone 1) — só perfil pessoal, bind só em
// localhost (essa máquina), pra validar o mecanismo antes de virar
// serviço de verdade (systemd + bind na interface Tailscale, como o
// ttyd fazia — ver docs/08).
const PORT = 8765;
const HOST = "127.0.0.1";

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

const wss = new WebSocketServer({ port: PORT, host: HOST });
console.log(`[relay] listening on ws://${HOST}:${PORT}`);

wss.on("connection", (socket: WebSocket) => {
  console.log("[relay] client connected");
  const session = new ClaudeSession();

  socket.on("message", (raw: Buffer) => {
    void (async () => {
      const parsed: unknown = JSON.parse(raw.toString());
      if (!isUserMessage(parsed)) {
        console.warn("[relay] mensagem ignorada, formato inesperado:", parsed);
        return;
      }

      await session.sendTurn(parsed.text, (event) => {
        socket.send(JSON.stringify({ type: "claude_event", event }));
      });
      socket.send(JSON.stringify({ type: "turn_complete" }));
    })();
  });

  socket.on("close", () => {
    console.log("[relay] client disconnected");
  });
});
