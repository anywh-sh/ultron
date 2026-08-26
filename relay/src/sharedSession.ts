import type { WebSocket } from "ws";
import { ClaudeSession, type ClaudeEvent } from "./claudeSession.js";
import { checkDirectory } from "./fsBrowse.js";
import { defaultCwd } from "./paths.js";
import { readHistoryFromTranscript } from "./transcriptReader.js";
import type { ContextUsage, PermissionMode } from "./sessionStore.js";

export type BroadcastMessage =
  | { type: "claude_event"; event: ClaudeEvent }
  | { type: "turn_complete"; stopped?: boolean }
  | { type: "turn_error"; message: string };

export interface SharedSessionOptions {
  /** session_id já persistido pra essa sessão (Fase 7 / docs/18), se houver. */
  initialSessionId?: string;
  /** Chamado com o session_id aprendido depois de cada turno bem-sucedido —
   * é assim que o SessionManager grava no SessionStore. */
  onSessionIdChange?: (sessionId: string) => void;
  /** cwd atual da sessão (padrão do app se o usuário nunca escolheu uma pasta). */
  initialCwd: string;
  /** Se `true`, a pasta já foi consumida por um turno e não pode mais mudar
   * — ver comentário em `runTurn` pro porquê. */
  initialLocked: boolean;
  /** Chamado sempre que o cwd muda (só possível antes do lock) — é assim
   * que o SessionManager grava no SessionStore. */
  onCwdChange?: (cwd: string) => void;
  /** Chamado uma única vez, no momento em que a sessão trava (primeiro
   * turno de verdade). */
  onLockChange?: () => void;
  /** Título já persistido pra essa sessão, se houver (sessão antiga migrada,
   * ou reload de uma sessão nova cujo título já tinha sido inferido antes do
   * restart do relay). */
  initialTitle?: string | null;
  /** Chamado uma única vez, com o texto do primeiro prompt de verdade —
   * SessionManager usa isso pra disparar a geração de título em paralelo ao
   * turno (não bloqueia a resposta). Mesmo momento que `onLockChange`, só
   * que já carrega o texto. */
  onFirstPrompt?: (text: string) => void;
  /** Chamado no início de TODO turno (não só o primeiro) — é o que deixa o
   * SessionManager marcar `lastActiveAt` no SessionStore, usado pra ordenar
   * a sidebar por última interação. */
  onActivity?: () => void;
  /** Modo de permissão já persistido pra essa sessão (docs/25), ou
   * `"bypassPermissions"` pra uma sessão nova — mesmo comportamento
   * hardcoded de antes dessa feature existir. */
  initialPermissionMode: PermissionMode;
  /** Chamado sempre que o modo muda — é assim que o SessionManager grava no
   * SessionStore. Diferente de `onCwdChange`, pode disparar a qualquer
   * momento da conversa (não só antes do primeiro turno). */
  onPermissionModeChange?: (mode: PermissionMode) => void;
  /** Uso de contexto já persistido pra essa sessão (último turno antes de um
   * possível restart do relay), se houver. */
  initialContextUsage?: ContextUsage;
  /** Chamado ao fim de todo turno que produziu um `result` utilizável — é
   * assim que o SessionManager grava no SessionStore. Pode não disparar num
   * turno que falhou antes de qualquer chamada de API. */
  onContextUsageChange?: (usage: ContextUsage) => void;
}

export type SetCwdResult = { ok: true } | { ok: false; error: string };

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
  private cwd: string;
  private locked: boolean;
  private title: string | null;
  private permissionMode: PermissionMode;
  private contextUsage: ContextUsage | undefined;

  constructor(
    private readonly homeOverride: string | undefined,
    private readonly options: SharedSessionOptions,
  ) {
    this.claude = new ClaudeSession({ homeOverride, initialSessionId: options.initialSessionId });
    this.cwd = options.initialCwd;
    this.locked = options.initialLocked;
    this.title = options.initialTitle ?? null;
    this.permissionMode = options.initialPermissionMode;
    this.contextUsage = options.initialContextUsage;
  }

  getCwdState(): { cwd: string; locked: boolean } {
    return { cwd: this.cwd, locked: this.locked };
  }

  getPermissionMode(): PermissionMode {
    return this.permissionMode;
  }

  getContextUsage(): ContextUsage | undefined {
    return this.contextUsage;
  }

  /** Diferente de `setCwd`, não tem trava nem validação — qualquer um dos
   * 4 valores é sempre aceitável a qualquer momento da conversa (docs/25). */
  setPermissionMode(mode: PermissionMode): void {
    this.permissionMode = mode;
    this.options.onPermissionModeChange?.(mode);
    this.broadcastPermissionMode();
  }

  getTitle(): string | null {
    return this.title;
  }

  /** Chamado tanto pelo título inferido do primeiro prompt quanto por um
   * rename manual (SessionManager.renameTitle) — os dois casos só precisam
   * atualizar o estado local e avisar quem estiver conectado agora mesmo
   * (outro dispositivo com essa sessão aberta, ex). Persistência em disco é
   * responsabilidade do SessionStore, não desta classe. */
  setTitle(title: string): void {
    this.title = title;
    this.broadcastTitle();
  }

  /** Só permitido antes do primeiro turno (ver `runTurn`) — quem chama
   * (server.ts) já trata o caso `ok: false` mandando um erro só pro cliente
   * que pediu, não um broadcast. */
  setCwd(path: string): SetCwdResult {
    if (this.locked) return { ok: false, error: "working directory já travado, sessão já tem histórico" };
    const check = checkDirectory(path);
    if (!check.ok) return { ok: false, error: check.error };
    this.cwd = check.path;
    this.options.onCwdChange?.(this.cwd);
    this.broadcastCwdState();
    return { ok: true };
  }

  addClient(socket: WebSocket): void {
    // Primeiro que tudo — uma aba recém-aberta sabe o cwd/lock imediatamente,
    // sem esperar um turno ou o replay de histórico terminar.
    this.sendCwdState(socket);
    this.sendPermissionMode(socket);
    if (this.title !== null) this.sendTitle(socket, this.title);
    this.sendContextUsage(socket);

    this.ensureHistoryLoaded();
    for (const message of this.history) {
      socket.send(JSON.stringify(message));
    }
    // Marca o fim do replay pra esse cliente — não entra em `history` (não é
    // um evento da sessão, é por-conexão), então nunca é reenviado pros
    // próximos clientes que conectarem. É o que deixa o cliente distinguir
    // "turn_complete" de reconstrução de histórico vs turno de verdade
    // concluído depois que ele conectou (relevante pra notificação do SO).
    socket.send(JSON.stringify({ type: "caught_up" }));
    this.clients.add(socket);
  }

  removeClient(socket: WebSocket): void {
    this.clients.delete(socket);
  }

  /** Chamado quando a sessão é excluída (SessionManager.deleteSession) —
   * avisa quem estiver conectado agora (esta aba, ou outro dispositivo com
   * a mesma sessão aberta) antes de fechar a conexão, pra distinguir de um
   * erro de rede de verdade. */
  closeAllClients(): void {
    for (const client of this.clients) {
      client.send(JSON.stringify({ type: "session_deleted" }));
      client.close();
    }
    this.clients.clear();
  }

  /**
   * `history` sempre foi só em memória — some a cada restart do relay,
   * mesmo o Claude Code tendo o transcript completo em disco (docs/20-backlog,
   * "Reconstrução de histórico de mensagens via `.jsonl`"). Roda uma vez por
   * processo: depois de carregado, `history` nunca mais fica vazio pra essa
   * sessão. Sem `initialSessionId` não tem o que ler (sessão nova).
   */
  private ensureHistoryLoaded(): void {
    if (this.history.length > 0 || !this.options.initialSessionId) return;
    const home = defaultCwd(this.homeOverride); // onde ~/.claude/projects/ do processo filho vive
    this.history.push(...readHistoryFromTranscript(home, this.cwd, this.options.initialSessionId));
  }

  submitTurn(text: string): void {
    // Enfileira: só um turno do `claude -p` roda por vez nessa sessão.
    this.turnQueue = this.turnQueue.then(() => this.runTurn(text));
  }

  /** Interrompe o turno em andamento, se houver — não mexe na fila (turnos
   * enfileirados, se algum dia existirem, continuam normalmente depois). */
  stopTurn(): void {
    this.claude.stop();
  }

  private async runTurn(text: string): Promise<void> {
    this.options.onActivity?.();

    // Trava a pasta no momento exato do primeiro turno de verdade — não na
    // conexão WS (que já acontece antes de qualquer mensagem) nem em
    // `submitTurn` (evita corrida entre dois `submitTurn` em sequência antes
    // do primeiro desenfileirar). O session_id que este turno pode gerar
    // fica amarrado ao `this.cwd` de agora pro `--resume` funcionar depois.
    if (!this.locked) {
      this.locked = true;
      this.options.onLockChange?.();
      this.broadcastCwdState();
      this.options.onFirstPrompt?.(text);
    }

    try {
      const { stopped, contextUsage } = await this.claude.sendTurn(text, this.cwd, this.permissionMode, (event) => {
        this.broadcast({ type: "claude_event", event });
      });
      const sessionId = this.claude.getSessionId();
      if (sessionId) this.options.onSessionIdChange?.(sessionId);
      if (contextUsage) {
        this.contextUsage = contextUsage;
        this.options.onContextUsageChange?.(contextUsage);
        this.broadcastContextUsage();
      }
      this.broadcast({ type: "turn_complete", stopped });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[relay] turno falhou:", message);
      this.broadcast({ type: "turn_error", message });
    }
  }

  private sendCwdState(target: WebSocket): void {
    target.send(JSON.stringify({ type: "cwd_state", cwd: this.cwd, locked: this.locked }));
  }

  private broadcastCwdState(): void {
    for (const client of this.clients) this.sendCwdState(client);
  }

  private sendPermissionMode(target: WebSocket): void {
    target.send(JSON.stringify({ type: "permission_mode_state", mode: this.permissionMode }));
  }

  private broadcastPermissionMode(): void {
    for (const client of this.clients) this.sendPermissionMode(client);
  }

  private sendContextUsage(target: WebSocket): void {
    if (!this.contextUsage) return;
    target.send(JSON.stringify({ type: "context_usage_state", usage: this.contextUsage }));
  }

  /** Mesmo raciocínio de `broadcastCwdState`/`broadcastTitle`: estado
   * "atual", não evento de `history` — uma reconexão pega o valor de agora
   * via `addClient` (`sendContextUsage`), não um replay de mudanças. */
  private broadcastContextUsage(): void {
    for (const client of this.clients) this.sendContextUsage(client);
  }

  private sendTitle(target: WebSocket, title: string): void {
    target.send(JSON.stringify({ type: "session_title", title }));
  }

  /** Não entra em `history` pelo mesmo motivo do cwd: é estado "atual", não
   * um evento da conversa — um cliente reconectando pega o valor de agora
   * via `addClient`, não um replay de mudanças passadas. */
  private broadcastTitle(): void {
    if (this.title === null) return;
    for (const client of this.clients) this.sendTitle(client, this.title);
  }

  private broadcast(message: BroadcastMessage): void {
    this.history.push(message);
    const payload = JSON.stringify(message);
    for (const client of this.clients) {
      client.send(payload);
    }
  }
}
