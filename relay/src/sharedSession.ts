import type { WebSocket } from "ws";
import { ClaudeSession, type ClaudeEvent } from "./claudeSession.js";
import { checkDirectory } from "./fsBrowse.js";
import { defaultCwd } from "./paths.js";
import { generateNotificationSummary } from "./notificationSummaryGenerator.js";
import { generateSuggestion } from "./suggestionGenerator.js";
import { readHistoryFromTranscript } from "./transcriptReader.js";
import { INITIAL_HISTORY_TAIL_TURNS, pageHistoryBefore } from "./historyPaging.js";
import type { ContextUsage, ModelChoice, PermissionMode } from "./sessionStore.js";
import type { FinishedBackgroundJob } from "./backgroundJobs.js";

/** Fase D de docs/32 — texto do turno sintético disparado quando um job
 * `ultron-bg` termina. Instrução explícita pra só reportar (não iniciar
 * trabalho novo nem outro `ultron-bg`) — sem essa trava, um turno automático
 * que já tem ferramentas liberadas (mesmo `permissionMode` da sessão)
 * poderia virar uma cadeia de ações não pedidas pelo usuário.
 */
function buildBackgroundJobFollowupPrompt(job: FinishedBackgroundJob): string {
  const status = job.exitCode === 0 ? "concluiu com sucesso (exit 0)" : `terminou com erro (exit ${String(job.exitCode)})`;
  const logTail = job.logTail.trim() || "(sem saída)";
  return (
    `[ultron-bg] O processo em background "${job.label}" que você iniciou ${status}. Log (cauda):\n` +
    "```\n" +
    logTail +
    "\n```\n\n" +
    "Resuma o resultado pro usuário, de forma concisa. Isto é só um relatório automático — não inicie " +
    "trabalho novo nem rode outro ultron-bg a partir daqui; se o resultado pedir alguma ação, pergunte " +
    "antes de agir."
  );
}

export type BroadcastMessage =
  | { type: "claude_event"; event: ClaudeEvent }
  | { type: "turn_complete"; stopped?: boolean }
  | { type: "turn_error"; message: string };

// `suggestion` (e outros estados "atuais": cwd_state, permission_mode_state
// etc.) não entra em `BroadcastMessage`/`history` de propósito — são mandados
// direto via socket.send em vez de `this.broadcast`, e uma reconexão pega o
// valor de agora via `addClient`, não um replay de mudanças passadas.

export interface SharedSessionOptions {
  /** session_id já persistido pra essa sessão (Fase 7 / docs/18), se houver. */
  initialSessionId?: string;
  /** Chamado com o session_id aprendido depois de cada turno bem-sucedido —
   * é assim que o SessionManager grava no SessionStore. */
  onSessionIdChange?: (sessionId: string) => void;
  /** Chamado quando `/clear` solta a continuidade local (docs/26) — é assim
   * que o SessionManager apaga o session_id gravado no SessionStore, senão
   * um restart do relay voltaria a dar `--resume` na conversa já limpa. */
  onSessionIdClear?: () => void;
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
  /** Chamado uma única vez, com o texto da primeira mensagem que não é um
   * comando (não começa com "/") — SessionManager usa isso pra disparar a
   * geração de título em paralelo ao turno (não bloqueia a resposta).
   * Desacoplado de `onLockChange` de propósito: uma sessão cujas primeiras
   * mensagens são `/model opus`/`/clear` trava o cwd normalmente no
   * primeiro turno, mas só ganha título quando uma mensagem de verdade
   * chegar (docs/26) — sem isso o título saía do texto do comando. */
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
  /** Modelo já persistido pra essa sessão (docs/26), ou `undefined` se nunca
   * escolhido via `/model` — nesse caso não passa `--model` no spawn,
   * comportamento idêntico a antes dessa feature existir. */
  initialModel?: ModelChoice;
  /** Chamado sempre que o modelo muda — mesmo padrão de
   * `onPermissionModeChange`, pode disparar a qualquer momento. */
  onModelChange?: (model: ModelChoice) => void;
  /** Chamado com todo `ClaudeEvent` de todo turno (real ou de follow-up de
   * background) — é assim que o `SessionManager` liga o `BackgroundJobTracker`
   * sem a `SharedSession` precisar saber nada sobre `ultron-bg` (docs/32,
   * Fase D). Puramente observacional. */
  onEvent?: (event: ClaudeEvent) => void;
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
  private model: ModelChoice | undefined;
  private contextUsage: ContextUsage | undefined;
  /** Sugestão de próxima mensagem (gerada de forma assíncrona ao fim de todo
   * turno bem-sucedido, ver `runTurn`) — só em memória, de propósito: é uma
   * conveniência de baixo risco, não precisa sobreviver a um restart do relay
   * (diferente de `contextUsage`, que é persistido no SessionStore). */
  private suggestion: string | null = null;
  /** Separado de `locked`: uma sessão pode travar o cwd no primeiro turno
   * (ex: um `/model opus` de abertura) sem ainda ter uma mensagem de verdade
   * pra título — ver `onFirstPrompt` acima. */
  private firstPromptSeeded = false;
  /** `true` depois de um `/clear` — impede `ensureHistoryLoaded` de recarregar
   * o transcript antigo do disco pra um cliente que conecta depois do clear
   * (o guard normal dela só olha `history.length`, que a gente zera de
   * propósito no clear). */
  private historyCleared = false;
  /** `null` fora de um turno — timestamp (epoch ms) de quando o turno atual
   * começou, enquanto um estiver rodando. Estado "atual" (como `cwd`),
   * não fica em `history`: um cliente conectando (ou reconectando) pega o
   * valor de agora via `addClient`, igual `sendCwdState`. */
  private turnStartedAt: number | null = null;

  constructor(
    private readonly homeOverride: string | undefined,
    private readonly options: SharedSessionOptions,
  ) {
    this.claude = new ClaudeSession({ homeOverride, initialSessionId: options.initialSessionId });
    this.cwd = options.initialCwd;
    this.locked = options.initialLocked;
    this.title = options.initialTitle ?? null;
    this.permissionMode = options.initialPermissionMode;
    this.model = options.initialModel;
    this.contextUsage = options.initialContextUsage;
  }

  getCwdState(): { cwd: string; locked: boolean } {
    return { cwd: this.cwd, locked: this.locked };
  }

  getPermissionMode(): PermissionMode {
    return this.permissionMode;
  }

  getModel(): ModelChoice | undefined {
    return this.model;
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

  /** Mesmo padrão de `setPermissionMode` — vale a partir do próximo turno,
   * sem trava nem validação de valor (o WS handler já valida contra
   * `MODEL_CHOICES` antes de chegar aqui, docs/26). */
  setModel(model: ModelChoice): void {
    this.model = model;
    this.options.onModelChange?.(model);
    this.broadcastModelState();
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
    this.sendModelState(socket);
    if (this.title !== null) this.sendTitle(socket, this.title);
    this.sendContextUsage(socket);
    this.sendSuggestion(socket);
    this.sendTurnState(socket);

    this.ensureHistoryLoaded();
    // Fase 2 (docs/30) — só a cauda recente (`INITIAL_HISTORY_TAIL_TURNS`
    // turnos), não `history` inteiro: sessões longas (achado real, "IVT
    // Fix" — 1670 linhas reconstruídas) travavam a conexão mandando tudo de
    // uma vez. O resto vem sob demanda via `loadOlderHistory`, disparado pelo
    // usuário rolando pra cima na UI. Uma única mensagem com o array inteiro
    // (não um `send` por evento) — é o que deixa o cliente hidratar o log
    // com um dispatch só em vez de um por evento (custo O(n²) do reducer).
    const page = pageHistoryBefore(this.history, this.history.length, INITIAL_HISTORY_TAIL_TURNS);
    socket.send(JSON.stringify({ type: "history_page", messages: page.messages, cursor: page.cursor, hasMore: page.hasMore }));
    // Marca o fim do replay pra esse cliente — não entra em `history` (não é
    // um evento da sessão, é por-conexão), então nunca é reenviado pros
    // próximos clientes que conectarem. É o que deixa o cliente distinguir
    // "turn_complete" de reconstrução de histórico vs turno de verdade
    // concluído depois que ele conectou (relevante pra notificação do SO).
    socket.send(JSON.stringify({ type: "caught_up" }));
    this.clients.add(socket);
  }

  /** Fase 2 (docs/30) — busca sob demanda de turnos mais antigos que a cauda
   * mandada em `addClient`, disparada pelo usuário rolando pra cima na UI.
   * Só responde pro socket que pediu: não é um evento da sessão (não entra
   * de novo em `history`, já está lá), é uma busca pontual de um cliente. */
  loadOlderHistory(socket: WebSocket, beforeCursor: number): void {
    const page = pageHistoryBefore(this.history, beforeCursor, INITIAL_HISTORY_TAIL_TURNS);
    socket.send(JSON.stringify({ type: "older_history", messages: page.messages, cursor: page.cursor, hasMore: page.hasMore }));
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
    if (this.history.length > 0 || this.historyCleared || !this.options.initialSessionId) return;
    const home = defaultCwd(this.homeOverride); // onde ~/.claude/projects/ do processo filho vive
    this.history.push(...readHistoryFromTranscript(home, this.cwd, this.options.initialSessionId));
  }

  /** `origin` é o socket que mandou esta mensagem — usado só pra saber quem
   * já tem a bolha da pergunta localmente (o `ChatPanel` de quem mandou já
   * commitou ela de forma otimista antes de chamar isto) e não duplicar nele
   * o `user_prompt` sintético que `runTurn` broadcasta pros OUTROS
   * dispositivos conectados na mesma sessão (ver comentário lá). */
  submitTurn(origin: WebSocket, text: string): void {
    // Sugestão de um turno anterior não vale mais assim que um novo começa —
    // limpa na hora (não espera o turno terminar) pra não ficar pendurada
    // durante toda a duração do turno em andamento.
    this.clearSuggestion();
    // Enfileira: só um turno do `claude -p` roda por vez nessa sessão.
    this.turnQueue = this.turnQueue.then(() => this.runTurn(origin, text));
  }

  /** Fase D de docs/32 — disparado pelo `BackgroundJobTracker` (via
   * `SessionManager`) quando um job iniciado com `ultron-bg` termina DEPOIS
   * que o turno original que o lançou já tinha acabado (o motivo de
   * `ultron-bg` existir: o processo `claude -p` daquele turno já morreu,
   * então não tem mais quem avisar o usuário por conta própria). Mesma
   * fila (`turnQueue`) que serializa `/clear` contra turnos de verdade —
   * nunca roda em paralelo com um turno do usuário nem corrompe
   * `session_id`/histórico fora de ordem. Sem `origin` (nenhum cliente
   * mandou isso) — `runTurn` broadcasta o prompt sintético pra todo mundo
   * conectado, não só "pros outros". */
  submitBackgroundJobResult(job: FinishedBackgroundJob): void {
    this.clearSuggestion();
    const text = buildBackgroundJobFollowupPrompt(job);
    this.turnQueue = this.turnQueue.then(() => this.runTurn(undefined, text, { label: job.label }));
  }

  /** Interrompe o turno em andamento, se houver — não mexe na fila (turnos
   * enfileirados, se algum dia existirem, continuam normalmente depois). */
  stopTurn(): void {
    this.claude.stop();
  }

  /** Resolve quando não houver turno em andamento (nem enfileirado) nesta
   * sessão — usado pelo shutdown gracioso do relay (server.ts) pra saber
   * quando é seguro sair sem interromper nada no meio. `turnQueue` nunca
   * rejeita (`runTurn` trata os próprios erros e nunca relança), então dá
   * pra devolver ele direto sem try/catch aqui. */
  waitForIdle(): Promise<void> {
    return this.turnQueue;
  }

  /** `/clear` (docs/26) — mesma fila dos turnos de verdade (`turnQueue`),
   * pra nunca correr em paralelo com um turno em andamento e arriscar um dos
   * dois sobrescrever o `session_id`/`history` do outro fora de ordem. Não
   * mexe em cwd, permissionMode nem model — só o CONTEÚDO da conversa reseta,
   * igual o `/clear` de verdade da CLI (só que sem rodar processo nenhum:
   * ver `ClaudeSession.resetSessionId`). */
  clearConversation(): void {
    this.turnQueue = this.turnQueue.then(() => {
      this.claude.resetSessionId();
      this.history.length = 0;
      this.historyCleared = true;
      this.contextUsage = undefined;
      this.options.onSessionIdClear?.();
      this.broadcastContextUsageReset();
      this.clearSuggestion();
      this.broadcastConversationReset();
    });
  }

  /** `origin` é `undefined` só pro turno de follow-up sintético
   * (`submitBackgroundJobResult`) — nenhum cliente específico "já tem a
   * bolha localmente" nesse caso, então o prompt sintético vai pra todo
   * mundo, e a trava de cwd/título (só faz sentido pro PRIMEIRO turno de
   * verdade da sessão, que por definição já aconteceu antes de qualquer job
   * existir pra terminar) é pulada. */
  private async runTurn(
    origin: WebSocket | undefined,
    text: string,
    synthetic?: { label: string },
  ): Promise<void> {
    this.options.onActivity?.();

    // Turno em andamento é estado "atual" (mesmo raciocínio de cwd/permissão/
    // modelo), não um evento de `history` — achado real testando multi-
    // dispositivo: sem isso, só quem mandou a mensagem via o indicador de
    // "pensando"/cronômetro (`TurnIndicator`), porque `turnInFlight` no
    // cliente só liga otimisticamente em quem clicou "Enviar". `startedAt`
    // (não só um booleano) deixa o cronômetro de outro dispositivo — ou de
    // um terceiro conectando no meio do turno — contar a partir do início
    // real, não de quando ele soube.
    this.turnStartedAt = Date.now();
    this.broadcastTurnState();

    // Sincroniza a pergunta pros OUTROS dispositivos conectados nesta mesma
    // sessão — achado real: sem isso, quem não mandou a mensagem via ao vivo
    // a resposta do assistente aparecer sem a pergunta que a motivou (o
    // protocolo nunca carregava o texto do usuário, só os eventos que a CLI
    // emite depois). Mesmo formato sintético que `transcriptReader.ts` já usa
    // pro replay reconstruído do disco — o reducer do cliente
    // (`useMessageLog.ts`) já sabe tratar `user_prompt`. Não manda pra
    // `origin`: quem mandou já commitou a bolha localmente de forma otimista
    // (`ChatPanel`), receber de volta duplicaria.
    {
      const event: ClaudeEvent = synthetic
        ? { type: "user_prompt", synthetic: "background_job", label: synthetic.label, message: { content: [{ type: "text", text }] } }
        : { type: "user_prompt", message: { content: [{ type: "text", text }] } };
      if (origin) {
        this.broadcastExcept({ type: "claude_event", event }, origin);
      } else {
        this.broadcast({ type: "claude_event", event });
      }
    }

    if (!synthetic) {
      // Trava a pasta no momento exato do primeiro turno de verdade — não na
      // conexão WS (que já acontece antes de qualquer mensagem) nem em
      // `submitTurn` (evita corrida entre dois `submitTurn` em sequência antes
      // do primeiro desenfileirar). O session_id que este turno pode gerar
      // fica amarrado ao `this.cwd` de agora pro `--resume` funcionar depois.
      if (!this.locked) {
        this.locked = true;
        this.options.onLockChange?.();
        this.broadcastCwdState();
      }
      // Comandos (`/clear`, `/model` etc, docs/26) não contam como primeiro
      // prompt de verdade pro título — só roda a geração quando a primeira
      // mensagem que não começa com "/" chegar, mesmo que não seja o primeiro
      // turno da sessão. Um turno sintético nunca conta (não é "a primeira
      // mensagem" de ninguém, e a sessão já tem título há muito tempo se um
      // job teve tempo de rodar e terminar).
      if (!this.firstPromptSeeded && !text.trim().startsWith("/")) {
        this.firstPromptSeeded = true;
        this.options.onFirstPrompt?.(text);
      }
    }

    try {
      const { stopped, contextUsage, lastAssistantText } = await this.claude.sendTurn(
        text,
        this.cwd,
        this.permissionMode,
        this.model,
        (event) => {
          this.broadcast({ type: "claude_event", event });
          // Fase D de docs/32 — deixa o tracker de jobs `ultron-bg` (dono na
          // `SessionManager`) ver todo evento de todo turno, procurando o
          // marcador de início. Puramente observacional: nunca lança nem
          // altera o fluxo do turno.
          this.options.onEvent?.(event);
        },
      );
      const sessionId = this.claude.getSessionId();
      if (sessionId) this.options.onSessionIdChange?.(sessionId);
      if (contextUsage) {
        this.contextUsage = contextUsage;
        this.options.onContextUsageChange?.(contextUsage);
        this.broadcastContextUsage();
      }
      this.broadcast({ type: "turn_complete", stopped });
      // Só sugere um follow-up de um turno que terminou de verdade (não
      // interrompido) — fire-and-forget, não atrasa `turn_complete` acima.
      // Velocidade não é prioridade aqui (é uma conveniência, não parte do
      // fluxo principal), então nenhum timeout/cancelamento é necessário.
      // Turno sintético (`synthetic`) nunca sugere: o "texto do usuário" que
      // alimentaria o gerador é a instrução interna do follow-up, não algo
      // que faça sentido oferecer como próxima mensagem de verdade.
      if (!stopped && !synthetic) {
        generateSuggestion(this.homeOverride, this.cwd, text, lastAssistantText)
          .then((suggestion) => {
            this.suggestion = suggestion ?? null;
            this.broadcastSuggestion();
          })
          .catch((error: unknown) => {
            console.error("[relay] falha ao gerar sugestão de próxima mensagem:", error);
          });
      }
      if (!stopped) {
        // Mesma ideia da sugestão acima (fire-and-forget, sem atrasar
        // turn_complete), mas pro resumo usado na notificação do SO — ver
        // notificationSummaryGenerator.ts. Diferente da sugestão, não é
        // "estado atual" (não fica em `this.*`/não reenvia em `addClient`):
        // é um evento de um turno específico, reproduzi-lo numa reconexão
        // dispararia uma notificação zumbi de um turno já visto.
        generateNotificationSummary(this.homeOverride, this.cwd, lastAssistantText)
          .then((summary) => this.broadcastNotificationSummary(summary ?? null))
          .catch((error: unknown) => {
            console.error("[relay] falha ao gerar resumo de notificação:", error);
          });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[relay] turno falhou:", message);
      this.broadcast({ type: "turn_error", message });
    } finally {
      this.turnStartedAt = null;
      this.broadcastTurnState();
    }
  }

  private sendTurnState(target: WebSocket): void {
    target.send(JSON.stringify({ type: "turn_state", active: this.turnStartedAt !== null, startedAt: this.turnStartedAt ?? undefined }));
  }

  private broadcastTurnState(): void {
    for (const client of this.clients) this.sendTurnState(client);
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

  /** Diferente de `sendContextUsage`, manda sempre — `model` indefinido é um
   * estado válido e final ("nunca escolhido, usa o padrão do CLI"), não um
   * "ainda não chegou" transitório, então não tem ambiguidade em avisar o
   * cliente logo na conexão. */
  private sendModelState(target: WebSocket): void {
    target.send(JSON.stringify({ type: "model_state", model: this.model ?? null }));
  }

  private broadcastModelState(): void {
    for (const client of this.clients) this.sendModelState(client);
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

  /** Só usado quando um `/clear` (ou equivalente) reinicia a conversa —
   * diferente de `sendContextUsage`, manda mesmo sem valor (`null`), porque
   * aqui o objetivo é avisar quem já está conectado que o valor anterior
   * não vale mais (o guard de `sendContextUsage` existe pra não confundir
   * "sessão nova, nunca teve turno" com "teve e foi resetada"). */
  private broadcastContextUsageReset(): void {
    for (const client of this.clients) {
      client.send(JSON.stringify({ type: "context_usage_state", usage: null }));
    }
  }

  /** Só pros clientes já conectados (mesmo raciocínio de
   * `broadcastContextUsageReset`) — quem conectar depois do clear já vê o
   * `history` vazio naturalmente via `addClient`, não precisa de sinal
   * nenhum. */
  private broadcastConversationReset(): void {
    for (const client of this.clients) {
      client.send(JSON.stringify({ type: "conversation_reset" }));
    }
  }

  /** Diferente de `sendContextUsage`, manda sempre (mesmo `null`) — não tem
   * ambiguidade de "ainda não chegou" pra distinguir aqui: uma sessão sem
   * nenhuma sugestão ainda e uma que teve a sugestão limpa parecem iguais
   * pro cliente (nenhuma das duas mostra placeholder nenhum), então não
   * precisa do guard que `sendContextUsage` tem. */
  private sendSuggestion(target: WebSocket): void {
    target.send(JSON.stringify({ type: "suggestion", text: this.suggestion }));
  }

  private broadcastSuggestion(): void {
    for (const client of this.clients) this.sendSuggestion(client);
  }

  private clearSuggestion(): void {
    if (this.suggestion === null) return;
    this.suggestion = null;
    this.broadcastSuggestion();
  }

  /** Evento efêmero de um turno específico (ver comentário em `runTurn`) —
   * manda só pros clientes conectados agora, sem guardar estado nenhum. */
  private broadcastNotificationSummary(text: string | null): void {
    for (const client of this.clients) client.send(JSON.stringify({ type: "notification_summary", text }));
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

  /** Mesmo que `broadcast` (entra em `history`, um terceiro dispositivo
   * conectando depois vê no replay), só que pula um socket — usado pelo
   * `user_prompt` sintético em `runTurn`, que não deve voltar pra quem já
   * tem a bolha localmente. */
  private broadcastExcept(message: BroadcastMessage, exclude: WebSocket): void {
    this.history.push(message);
    const payload = JSON.stringify(message);
    for (const client of this.clients) {
      if (client !== exclude) client.send(payload);
    }
  }
}
