import type { WebSocket } from "ws";
import { ClaudeSession, type ClaudeEvent } from "./claudeSession.js";

export type BroadcastMessage =
  | { type: "claude_event"; event: ClaudeEvent }
  | { type: "turn_complete" }
  | { type: "turn_error"; message: string };

export interface SharedSessionOptions {
  /** session_id já persistido pra essa sessão (Fase 7 / docs/18), se houver. */
  initialSessionId?: string;
  /** Chamado com o session_id aprendido depois de cada turno bem-sucedido —
   * é assim que o SessionManager grava no SessionStore. */
  onSessionIdChange?: (sessionId: string) => void;
}

/**
 * Uma sessão do Claude compartilhada por todos os clientes conectados nela.
 * Novos clientes recebem replay do histórico antes de passar a receber
 * eventos ao vivo — é isso que dá a "sessão compartilhada em tempo real"
 * entre dispositivos (docs/04 antigo, agora via docs/11).
 */
export class SharedSession {
  private readonly claude: ClaudeSession;
  private readonly history: BroadcastMessage[] = [];
  private readonly clients = new Set<WebSocket>();
  private turnQueue: Promise<void> = Promise.resolve();

  constructor(
    homeOverride: string | undefined,
    private readonly options: SharedSessionOptions = {},
  ) {
    this.claude = new ClaudeSession({ homeOverride, initialSessionId: options.initialSessionId });
  }

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
      const sessionId = this.claude.getSessionId();
      if (sessionId) this.options.onSessionIdChange?.(sessionId);
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
