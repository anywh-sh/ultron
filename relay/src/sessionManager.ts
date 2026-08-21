import { generateTitle } from "./titleGenerator.js";
import { SharedSession } from "./sharedSession.js";
import type { SessionStore } from "./sessionStore.js";

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

  constructor(
    private readonly homeOverride: string | undefined,
    private readonly sessionStore: SessionStore,
  ) {
    for (const id of sessionStore.listIds()) {
      this.sessions.set(id, this.createSession(id));
    }
  }

  listTitled(): { id: string; title: string }[] {
    return this.sessionStore.listTitled();
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
      initialCwd: cwd,
      initialLocked: locked,
      onCwdChange: (newCwd) => this.sessionStore.setCwd(id, newCwd),
      onLockChange: () => this.sessionStore.lockCwd(id),
      onActivity: () => this.sessionStore.touch(id),
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
