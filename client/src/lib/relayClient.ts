// Cliente do protocolo do relay próprio (não é mais o protocolo do ttyd —
// ver docs/11-decisao-pivo-stream-json.md e docs/12-prototipo-relay.md).
import type { ClaudeEvent, RelayMessage, SessionSummary } from "@/lib/relay-types";

export type { ClaudeContentBlock, ClaudeMessage, ClaudeEvent, SessionSummary } from "@/lib/relay-types";

function isRelayMessage(value: unknown): value is RelayMessage {
  return typeof value === "object" && value !== null && "type" in value;
}

export async function fetchSessions(host: string, port: number): Promise<SessionSummary[]> {
  const response = await fetch(`http://${host}:${port}/sessions`);
  const body = (await response.json()) as { sessions?: SessionSummary[] };
  return body.sessions ?? [];
}

/** Rename manual (dialog na sidebar) — funciona mesmo pra uma sessão sem
 * aba aberta agora (o relay só precisa do id, não de uma conexão WS viva). */
export async function renameSession(host: string, port: number, id: string, title: string): Promise<void> {
  const response = await fetch(`http://${host}:${port}/sessions/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, title }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `falha ao renomear sessão (${String(response.status)})`);
  }
}

/** Só tira a sessão do controle do ultron (sidebar, abas) — não apaga o
 * transcript que o Claude Code já mantém sozinho. Funciona mesmo pra uma
 * sessão sem aba aberta agora. */
export async function deleteSession(host: string, port: number, id: string): Promise<void> {
  const response = await fetch(`http://${host}:${port}/sessions/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `falha ao excluir sessão (${String(response.status)})`);
  }
}

export interface RelayClientCallbacks {
  onEvent: (event: ClaudeEvent) => void;
  onTurnComplete: (stopped: boolean) => void;
  onTurnError: (message: string) => void;
  /** Fim do replay do histórico dessa sessão — turnos concluídos recebidos
   * depois disso são de verdade novos, não reconstrução (ver sharedSession.ts). */
  onCaughtUp: () => void;
  /** Mandado logo na conexão (antes do replay de histórico) e de novo toda
   * vez que o working directory muda ou trava — ver sharedSession.ts. */
  onCwdState: (cwd: string, locked: boolean) => void;
  onSetCwdError?: (message: string) => void;
  onConnectionChange?: (connected: boolean) => void;
  /** Título inferido do primeiro prompt (ou de um rename manual feito em
   * outro dispositivo) chegando ao vivo — ver sharedSession.ts::setTitle. */
  onSessionTitle?: (title: string) => void;
  /** Sessão excluída (por este dispositivo ou outro) — ver
   * sharedSession.ts::closeAllClients. O socket já fecha logo em seguida. */
  onSessionDeleted?: () => void;
}

export class RelayClient {
  private socket?: WebSocket;
  /** Pasta escolhida (ex: pelo `WorkingDirectoryButton` de uma conversa nova)
   * antes do socket abrir — não existe fila de saída, só a última escolha
   * importa. Mandada assim que a conexão abre; ver `connect`. */
  private pendingCwd: string | null = null;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly sessionId: string,
    private readonly callbacks: RelayClientCallbacks,
  ) {}

  connect(): void {
    const socket = new WebSocket(
      `ws://${this.host}:${this.port}/?session=${encodeURIComponent(this.sessionId)}`,
    );
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.callbacks.onConnectionChange?.(true);
      if (this.pendingCwd !== null) {
        const path = this.pendingCwd;
        this.pendingCwd = null;
        socket.send(JSON.stringify({ type: "set_cwd", path }));
      }
    });
    socket.addEventListener("close", () => this.callbacks.onConnectionChange?.(false));
    socket.addEventListener("message", (event) => {
      const parsed: unknown = JSON.parse(event.data as string);
      if (!isRelayMessage(parsed)) return;

      if (parsed.type === "claude_event") {
        this.callbacks.onEvent(parsed.event);
      } else if (parsed.type === "turn_complete") {
        this.callbacks.onTurnComplete(parsed.stopped === true);
      } else if (parsed.type === "turn_error") {
        this.callbacks.onTurnError(parsed.message);
      } else if (parsed.type === "caught_up") {
        this.callbacks.onCaughtUp();
      } else if (parsed.type === "cwd_state") {
        this.callbacks.onCwdState(parsed.cwd, parsed.locked);
      } else if (parsed.type === "set_cwd_error") {
        this.callbacks.onSetCwdError?.(parsed.message);
      } else if (parsed.type === "session_title") {
        this.callbacks.onSessionTitle?.(parsed.title);
      } else if (parsed.type === "session_deleted") {
        this.callbacks.onSessionDeleted?.();
      }
    });
  }

  sendMessage(text: string): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: "user_message", text }));
  }

  stopTurn(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: "stop_turn" }));
  }

  setCwd(path: string): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      // Aba de conversa nova deixa escolher a pasta antes da conexão abrir
      // (ver WorkingDirectoryButton) — guarda e manda assim que abrir, em
      // vez de simplesmente descartar a escolha do usuário.
      this.pendingCwd = path;
      return;
    }
    this.socket.send(JSON.stringify({ type: "set_cwd", path }));
  }

  disconnect(): void {
    this.socket?.close();
  }
}
