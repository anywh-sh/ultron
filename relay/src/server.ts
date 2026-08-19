import { WebSocketServer, type WebSocket } from "ws";
import { ClaudeSession, type ClaudeEvent } from "./claudeSession.js";

// Config via env — permite rodar uma instância por perfil (systemd,
// infra/systemd/) sem mudar código, igual o ttyd fazia (docs/08).
const PORT = Number(process.env.RELAY_PORT ?? 8765);
const HOST = process.env.RELAY_HOST ?? "127.0.0.1";
const HOME_OVERRIDE = process.env.RELAY_HOME_OVERRIDE;

type BroadcastMessage =
  | { type: "claude_event"; event: ClaudeEvent }
  | { type: "turn_complete" }
  | { type: "turn_error"; message: string };

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

/**
 * Uma sessão do Claude compartilhada por todos os clientes conectados nesse
 * processo (= um perfil). Novos clientes recebem replay do histórico antes
 * de passar a receber eventos ao vivo — é isso que dá a "sessão
 * compartilhada em tempo real" entre dispositivos, equivalente ao que o
 * tmux dava de graça na arquitetura anterior (docs/04).
 */
class SharedSession {
  private readonly claude = new ClaudeSession({ homeOverride: HOME_OVERRIDE });
  private readonly history: BroadcastMessage[] = [];
  private readonly clients = new Set<WebSocket>();
  private turnQueue: Promise<void> = Promise.resolve();

  addClient(socket: WebSocket): void {
    for (const message of this.history) {
      socket.send(JSON.stringify(message));
    }
    this.clients.add(socket);
  }

  removeClient(socket: WebSocket): void {
    this.clients.delete(socket);
  }

  submitTurn(text: string): void {
    // Enfileira: só um turno do `claude -p` roda por vez nessa sessão.
    this.turnQueue = this.turnQueue.then(() => this.runTurn(text));
  }

  private async runTurn(text: string): Promise<void> {
    try {
      await this.claude.sendTurn(text, (event) => {
        this.broadcast({ type: "claude_event", event });
      });
      this.broadcast({ type: "turn_complete" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[relay] turno falhou:", message);
      this.broadcast({ type: "turn_error", message });
    }
  }

  private broadcast(message: BroadcastMessage): void {
    this.history.push(message);
    const payload = JSON.stringify(message);
    for (const client of this.clients) {
      client.send(payload);
    }
  }
}

const session = new SharedSession();

const wss = new WebSocketServer({ port: PORT, host: HOST });
console.log(`[relay] listening on ws://${HOST}:${PORT}`, HOME_OVERRIDE ? `(HOME=${HOME_OVERRIDE})` : "");

wss.on("connection", (socket: WebSocket) => {
  console.log("[relay] client connected");
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
    console.log("[relay] client disconnected");
  });
});
