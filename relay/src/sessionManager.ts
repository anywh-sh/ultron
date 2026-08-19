import { SharedSession } from "./sharedSession.js";

// Múltiplas sessões nomeadas dentro de um mesmo perfil (= um processo de
// relay) — equivalente ao que janelas tmux davam na arquitetura antiga
// (docs/08), agora em cima do relay. Nomes ficam só em memória, criados
// sob demanda quando um cliente conecta pedindo um nome que ainda não existe.
export class SessionManager {
  private readonly sessions = new Map<string, SharedSession>();

  constructor(private readonly homeOverride: string | undefined) {}

  listNames(): string[] {
    return [...this.sessions.keys()];
  }

  getOrCreate(name: string): SharedSession {
    let session = this.sessions.get(name);
    if (!session) {
      session = new SharedSession(this.homeOverride);
      this.sessions.set(name, session);
    }
    return session;
  }
}
