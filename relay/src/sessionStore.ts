import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Mapeamento nome de sessão -> session_id, persistido em disco por perfil —
// sem isso, GET /sessions e a continuidade via --resume dependiam só de
// memória (SessionManager era um Map puro) e sumiam a cada restart do
// relay, mesmo com o Claude Code mantendo o histórico real intacto em
// ~/.claude/projects/. Ver docs/18. Reconstrução do HISTÓRICO de mensagens
// a partir desses IDs fica fora de escopo por ora (ver docs/18, seção
// "Deferido") — aqui só garantimos que o nome continua listado e a sessão
// continua retomável.
export type SessionRecord = Record<string, string | null>;

export class SessionStore {
  private records: SessionRecord;

  constructor(private readonly filePath: string) {
    this.records = this.load();
  }

  private load(): SessionRecord {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as SessionRecord;
      }
      return {};
    } catch {
      // Arquivo ausente na primeira vez, ou corrompido — nunca crasha o
      // relay por causa disso, só começa com o mapeamento vazio.
      return {};
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.records, null, 2));
  }

  listNames(): string[] {
    return Object.keys(this.records);
  }

  getSessionId(name: string): string | undefined {
    return this.records[name] ?? undefined;
  }

  /** Idempotente — garante que o nome já apareça em GET /sessions mesmo
   * antes do primeiro turno terminar (e portanto antes de termos um
   * session_id de verdade pra ele). */
  recordName(name: string): void {
    if (name in this.records) return;
    this.records[name] = null;
    this.persist();
  }

  recordSessionId(name: string, sessionId: string): void {
    this.records[name] = sessionId;
    this.persist();
  }
}
