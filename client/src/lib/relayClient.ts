// Cliente do protocolo do relay próprio (não é mais o protocolo do ttyd —
// ver docs/11-decisao-pivo-stream-json.md e docs/12-prototipo-relay.md).
import type { ClaudeEvent, ContextUsage, ModelChoice, PermissionMode, RelayMessage, SessionSummary } from "@/lib/relay-types";

export type {
  ClaudeContentBlock,
  ClaudeMessage,
  ClaudeEvent,
  ContextUsage,
  ModelChoice,
  PermissionMode,
  SessionSummary,
} from "@/lib/relay-types";

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
  /** Mandado logo na conexão (antes do replay) e de novo toda vez que o modo
   * muda — ver sharedSession.ts::setPermissionMode. */
  onPermissionModeState: (mode: PermissionMode) => void;
  /** Mandado logo na conexão e de novo toda vez que o modelo muda — ver
   * sharedSession.ts::setModel. `null` é um estado final válido ("nunca
   * escolhido via /model, usa o padrão do CLI"), não "ainda carregando". */
  onModelState: (model: ModelChoice | null) => void;
  /** Mandado logo na conexão (se já houver algum turno concluído nessa
   * sessão) e de novo ao fim de todo turno que produziu uso de contexto —
   * ver sharedSession.ts::broadcastContextUsage. `null` depois de um
   * `/clear` (ver onConversationReset). */
  onContextUsageState?: (usage: ContextUsage | null) => void;
  /** `/clear` (docs/26) — a conversa dessa sessão foi resetada (por este
   * dispositivo ou outro); quem consome isso deve esvaziar o log de
   * mensagens local, mesma ideia do `reset()` já usado em `onReconnecting`. */
  onConversationReset?: () => void;
  onConnectionChange?: (connected: boolean) => void;
  /** Título inferido do primeiro prompt (ou de um rename manual feito em
   * outro dispositivo) chegando ao vivo — ver sharedSession.ts::setTitle. */
  onSessionTitle?: (title: string) => void;
  /** Sessão excluída (por este dispositivo ou outro) — ver
   * sharedSession.ts::closeAllClients. O socket já fecha logo em seguida. */
  onSessionDeleted?: () => void;
  /** Disparado logo antes de reabrir a conexão (backoff automático ou
   * `forceReconnect`) — nunca na primeira conexão. O relay reenvia o
   * histórico inteiro a cada conexão nova (`SharedSession.addClient`), então
   * quem consome isso deve resetar o log de mensagens aqui, senão o replay
   * duplica tudo em cima do que já estava na tela (docs/23, Fase D1). */
  onReconnecting?: () => void;
}

const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 30_000;

export class RelayClient {
  private socket?: WebSocket;
  /** Pasta escolhida (ex: pelo `WorkingDirectoryButton` de uma conversa nova)
   * antes do socket abrir — não existe fila de saída, só a última escolha
   * importa. Mandada assim que a conexão abre; ver `connect`. */
  private pendingCwd: string | null = null;
  /** Mesma lógica do `pendingCwd` — só a última escolha antes do socket
   * abrir importa. */
  private pendingPermissionMode: PermissionMode | null = null;
  /** `false` só depois de `disconnect()` deliberado (troca de aba/sessão) —
   * enquanto `true`, todo `close` inesperado agenda uma nova tentativa. */
  private shouldReconnect = true;
  private reconnectTimer: number | undefined;
  private reconnectAttempt = 0;
  /** Conta toda chamada de `connect()`, incluindo a primeira — usado só pra
   * saber se uma reconexão está em curso (`> 1`), pra não disparar
   * `onReconnecting` na conexão inicial. */
  private connectCount = 0;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly sessionId: string,
    private readonly callbacks: RelayClientCallbacks,
  ) {}

  connect(): void {
    this.connectCount += 1;
    if (this.connectCount > 1) this.callbacks.onReconnecting?.();

    const socket = new WebSocket(
      `ws://${this.host}:${this.port}/?session=${encodeURIComponent(this.sessionId)}`,
    );
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      this.callbacks.onConnectionChange?.(true);
      if (this.pendingCwd !== null) {
        const path = this.pendingCwd;
        this.pendingCwd = null;
        socket.send(JSON.stringify({ type: "set_cwd", path }));
      }
      if (this.pendingPermissionMode !== null) {
        const mode = this.pendingPermissionMode;
        this.pendingPermissionMode = null;
        socket.send(JSON.stringify({ type: "set_permission_mode", mode }));
      }
    });
    socket.addEventListener("close", () => {
      // Evento tardio de um socket que `forceReconnect`/reconexão automática
      // já substituiu — ignora, senão sinaliza desconectado por cima de uma
      // conexão nova que já pode estar aberta.
      if (this.socket !== socket) return;
      this.callbacks.onConnectionChange?.(false);
      this.scheduleReconnect();
    });
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
      } else if (parsed.type === "permission_mode_state") {
        this.callbacks.onPermissionModeState(parsed.mode);
      } else if (parsed.type === "model_state") {
        this.callbacks.onModelState(parsed.model);
      } else if (parsed.type === "context_usage_state") {
        this.callbacks.onContextUsageState?.(parsed.usage);
      } else if (parsed.type === "conversation_reset") {
        this.callbacks.onConversationReset?.();
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

  setPermissionMode(mode: PermissionMode): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      this.pendingPermissionMode = mode;
      return;
    }
    this.socket.send(JSON.stringify({ type: "set_permission_mode", mode }));
  }

  /** Sem fila de "pendente antes de conectar" (diferente de `setCwd`/
   * `setPermissionMode`): só é acionado via `/model` digitado no composer,
   * que já fica desabilitado enquanto `!connected` — nunca dá pra chamar
   * isso antes do socket abrir. */
  setModel(model: ModelChoice): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: "set_model", model }));
  }

  /** `/clear` (docs/26) — mesmo raciocínio de `setModel` sobre não precisar
   * de fila de pendência. */
  clearConversation(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: "clear_conversation" }));
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.socket?.close();
  }

  /** Chamado ao voltar de background/foreground (docs/23, Fase D1) — não
   * confia no timing do `close` nativo, que pode nunca disparar num socket
   * "zumbi" (`readyState` ainda `OPEN` mas a conexão de rede já morreu de
   * verdade). Só reconecta se o socket não estiver genuinamente utilizável;
   * uma conexão saudável fica intocada (spike 3 mostrou que sockets
   * costumam sobreviver a background curto sem intervenção nenhuma). */
  forceReconnect(): void {
    const state = this.socket?.readyState;
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;
    this.clearReconnectTimer();
    this.connect();
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_DELAY_MS);
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== undefined) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }
}
