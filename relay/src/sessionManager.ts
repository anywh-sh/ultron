import { SharedSession } from "./sharedSession.js";
import type { SessionStore } from "./sessionStore.js";

// Múltiplas sessões nomeadas dentro de um mesmo perfil (= um processo de
// relay) — equivalente ao que janelas tmux davam na arquitetura antiga
// (docs/08), agora em cima do relay. Nomes eram só em memória (sumiam a
// cada restart) até a Fase 7 (docs/18) — agora persistem via SessionStore;
// no boot, materializamos uma SharedSession pra cada nome já persistido
// (barato: o construtor não faz I/O nem spawn), então `listNames()` reflete
// o estado persistido imediatamente, sem caminho de código separado.
export class SessionManager {
  private readonly sessions = new Map<string, SharedSession>();

  constructor(
    private readonly homeOverride: string | undefined,
    private readonly sessionStore: SessionStore,
  ) {
    for (const name of sessionStore.listNames()) {
      this.sessions.set(name, this.createSession(name));
    }
  }

  listNames(): string[] {
    return [...this.sessions.keys()];
  }

  getOrCreate(name: string): SharedSession {
    let session = this.sessions.get(name);
    if (!session) {
      this.sessionStore.recordName(name);
      session = this.createSession(name);
      this.sessions.set(name, session);
    }
    return session;
  }

  private createSession(name: string): SharedSession {
    return new SharedSession(this.homeOverride, {
      initialSessionId: this.sessionStore.getSessionId(name),
      onSessionIdChange: (sessionId) => this.sessionStore.recordSessionId(name, sessionId),
    });
  }
}
