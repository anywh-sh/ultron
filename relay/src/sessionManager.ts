import { generateTitle } from "./titleGenerator.js";
import { SharedSession } from "./sharedSession.js";
import type { SessionStore } from "./sessionStore.js";
import { BackgroundJobTracker, type FinishedBackgroundJob } from "./backgroundJobs.js";

// Múltiplas sessões identificadas por id dentro de um mesmo perfil (= um
// processo de relay) — equivalente ao que janelas tmux davam na arquitetura
// antiga (docs/08), agora em cima do relay. Nomes eram só em memória (sumiam
// a cada restart) até a Fase 7 (docs/18) — agora persistem via SessionStore;
// no boot, materializamos uma SharedSession pra cada id já persistido
// (barato: o construtor não faz I/O nem spawn). `id` é estável desde a
// criação e nunca muda; `title` (exibido na UI) começa `null` — só sessões
// já tituladas entram em `listTitled()`, que é o que a sidebar lista.
export class SessionManager {
  private readonly sessions = new Map<string, SharedSession>();
  /** Um tracker só pro processo inteiro (não um por sessão) — jobs
   * `ultron-bg` de sessões diferentes não têm relação entre si, mas o
   * poller e o teto de observação (docs/32, Fase C) fazem mais sentido
   * compartilhados do que duplicados N vezes. */
  private readonly backgroundJobs = new BackgroundJobTracker({
    onFinished: (job) => this.handleBackgroundJobFinished(job),
    onChanged: (sessionId) => this.syncBackgroundJobState(sessionId),
  });

  constructor(
    private readonly homeOverride: string | undefined,
    private readonly sessionStore: SessionStore,
  ) {
    for (const id of sessionStore.listIds()) {
      this.sessions.set(id, this.createSession(id));
    }
  }

  /** Fase D de docs/32 — chamado pelo `BackgroundJobTracker` quando um job
   * termina. `this.sessions.get` (não `getOrCreate`): se a sessão foi
   * deletada enquanto o job rodava, não tem pra quem reportar — descarta
   * silenciosamente em vez de ressuscitar uma entrada no `SessionStore`. */
  private handleBackgroundJobFinished(job: FinishedBackgroundJob): void {
    const session = this.sessions.get(job.sessionId);
    if (!session) {
      console.warn(
        `[relay] background job "${job.label}" (${job.id}) terminou, mas a sessão ${job.sessionId} não existe mais — descartando`,
      );
      return;
    }
    session.submitBackgroundJobResult(job);
  }

  /** Fase E de docs/32 — mantém o `background_job_state` que a `SharedSession`
   * expõe pro cliente em sincronia com o tracker sempre que a lista de jobs
   * observados de uma sessão muda (início, fim ou expiração). Sessão sem aba
   * aberta (`this.sessions.get` undefined) simplesmente não tem pra quem
   * mandar — sem efeito, o tracker continua sendo a fonte de verdade. */
  private syncBackgroundJobState(sessionId: string): void {
    this.sessions.get(sessionId)?.setBackgroundJobs(this.backgroundJobs.listWatchedForSession(sessionId));
  }

  listTitled(): { id: string; title: string }[] {
    return this.sessionStore.listTitled();
  }

  /** Resolve quando nenhuma sessão tiver turno em andamento — usado pelo
   * shutdown gracioso (server.ts) antes de deixar o processo sair. */
  async waitForAllIdle(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) => session.waitForIdle()));
  }

  /** Interrompe (SIGINT, mesmo caminho do botão "Parar") o turno em
   * andamento de toda sessão — usado só como fallback do shutdown gracioso
   * quando o prazo de espera normal estoura, pra terminar rápido e limpo em
   * vez de deixar o systemd matar os processos `claude -p` cru. */
  stopAllTurns(): void {
    for (const session of this.sessions.values()) session.stopTurn();
  }

  getOrCreate(id: string): SharedSession {
    let session = this.sessions.get(id);
    if (!session) {
      this.sessionStore.recordId(id);
      session = this.createSession(id);
      this.sessions.set(id, session);
    }
    return session;
  }

  /** Rename manual (dialog na sidebar) — funciona mesmo pra uma sessão sem
   * aba aberta no momento (`sessions.get` pode dar `undefined`; só o
   * SessionStore precisa existir). Se a sessão estiver aberta em algum
   * dispositivo, `SharedSession.setTitle` propaga a mudança ao vivo. */
  renameTitle(id: string, title: string): boolean {
    if (this.sessionStore.getTitle(id) === null && !this.sessions.has(id)) return false;
    this.sessionStore.setTitle(id, title);
    this.sessions.get(id)?.setTitle(title);
    return true;
  }

  /** Só tira a sessão do controle do ultron (SessionStore + mapa em
   * memória) — não apaga o transcript que o Claude Code já mantém sozinho
   * em `~/.claude/projects/`. Para o turno em andamento (se houver) e avisa
   * quem estiver conectado antes de derrubar a conexão. */
  deleteSession(id: string): boolean {
    const session = this.sessions.get(id);
    if (session) {
      session.stopTurn();
      session.closeAllClients();
      this.sessions.delete(id);
    }
    const existedInStore = this.sessionStore.deleteEntry(id);
    return existedInStore || session !== undefined;
  }

  private createSession(id: string): SharedSession {
    const { cwd, locked } = this.sessionStore.getCwdState(id);
    const session = new SharedSession(this.homeOverride, {
      initialSessionId: this.sessionStore.getSessionId(id),
      onSessionIdChange: (sessionId) => this.sessionStore.recordSessionId(id, sessionId),
      onSessionIdClear: () => this.sessionStore.clearSessionId(id),
      initialCwd: cwd,
      initialLocked: locked,
      onCwdChange: (newCwd) => this.sessionStore.setCwd(id, newCwd),
      onLockChange: () => this.sessionStore.lockCwd(id),
      initialPermissionMode: this.sessionStore.getPermissionMode(id),
      onPermissionModeChange: (mode) => this.sessionStore.setPermissionMode(id, mode),
      initialModel: this.sessionStore.getModel(id),
      onModelChange: (model) => this.sessionStore.setModel(id, model),
      initialContextUsage: this.sessionStore.getContextUsage(id),
      onContextUsageChange: (usage) => this.sessionStore.setContextUsage(id, usage),
      onActivity: () => this.sessionStore.touch(id),
      onEvent: (event) => this.backgroundJobs.observeEvent(id, event),
      initialTitle: this.sessionStore.getTitle(id),
      onFirstPrompt: (text) => {
        // Só dispara pra sessão de verdade nova — uma sessão migrada de um
        // formato antigo já chega com `initialTitle` preenchido (o nome de
        // então), então nunca teve `title` null pra começo de conversa.
        if (this.sessionStore.getTitle(id) !== null) return;
        generateTitle(this.homeOverride, session.getCwdState().cwd, text)
          .then((title) => {
            this.sessionStore.setTitle(id, title);
            session.setTitle(title);
          })
          .catch((error: unknown) => {
            console.error("[relay] falha ao gerar título da sessão:", error);
          });
      },
    });
    return session;
  }
}
