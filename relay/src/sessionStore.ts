import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Mapeamento nome de sessão -> { session_id, cwd/lock }, persistido em disco
// por perfil — sem isso, GET /sessions, a continuidade via --resume e (desde
// a feature de working directory) a pasta de trabalho de cada sessão
// dependiam só de memória e sumiam a cada restart do relay. Ver docs/18 (a
// parte de session_id) e o plano "working directory" (a parte de cwd/lock).
export interface SessionCwdState {
  cwd: string;
  /** Trava depois do primeiro turno — o session_id do Claude Code fica
   * amarrado ao cwd usado no spawn (confirmado inspecionando
   * ~/.claude/projects/<cwd-sanitizado>/), então trocar a pasta de uma
   * sessão com histórico quebraria o --resume subsequente. Ver
   * SharedSession.runTurn, que é quem decide o momento exato do lock. */
  locked: boolean;
}

export interface SessionEntry {
  sessionId: string | null;
  cwd: SessionCwdState;
}

export type SessionRecord = Record<string, SessionEntry>;

/** Shape anterior a essa mudança: nome -> session_id (ou null). Usado só pra
 * detectar e migrar arquivos de sessão já existentes em produção. */
type LegacySessionRecord = Record<string, string | null>;

function isLegacyRecord(value: object): value is LegacySessionRecord {
  return Object.values(value).every((entry) => typeof entry === "string" || entry === null);
}

export class SessionStore {
  private records: SessionRecord;
  private migrated = false;

  constructor(
    private readonly filePath: string,
    private readonly defaultCwd: string,
  ) {
    this.records = this.load();
    if (this.migrated) this.persist();
  }

  private load(): SessionRecord {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch {
      // Arquivo ausente na primeira vez, ou corrompido — nunca crasha o
      // relay por causa disso, só começa com o mapeamento vazio.
      return {};
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    if (isLegacyRecord(parsed)) {
      this.migrated = true;
      const migrated: SessionRecord = {};
      for (const [name, sessionId] of Object.entries(parsed)) {
        // Sessão que já tinha session_id de verdade já tem histórico
        // gravado sob o cwd implícito de então (homeOverride ?? homedir()) —
        // trata como já travada, pra não arriscar quebrar o --resume dela.
        migrated[name] = { sessionId, cwd: { cwd: this.defaultCwd, locked: sessionId !== null } };
      }
      return migrated;
    }

    return parsed as SessionRecord;
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.records, null, 2));
  }

  listNames(): string[] {
    return Object.keys(this.records);
  }

  getSessionId(name: string): string | undefined {
    return this.records[name]?.sessionId ?? undefined;
  }

  /** Idempotente — garante que o nome já apareça em GET /sessions mesmo
   * antes do primeiro turno terminar (e portanto antes de termos um
   * session_id de verdade pra ele). */
  recordName(name: string): void {
    if (name in this.records) return;
    this.records[name] = { sessionId: null, cwd: { cwd: this.defaultCwd, locked: false } };
    this.persist();
  }

  recordSessionId(name: string, sessionId: string): void {
    this.ensureEntry(name);
    this.records[name].sessionId = sessionId;
    this.persist();
  }

  getCwdState(name: string): SessionCwdState {
    return this.records[name]?.cwd ?? { cwd: this.defaultCwd, locked: false };
  }

  setCwd(name: string, cwd: string): void {
    this.ensureEntry(name);
    this.records[name].cwd.cwd = cwd;
    this.persist();
  }

  lockCwd(name: string): void {
    this.ensureEntry(name);
    this.records[name].cwd.locked = true;
    this.persist();
  }

  private ensureEntry(name: string): void {
    if (!(name in this.records)) {
      this.records[name] = { sessionId: null, cwd: { cwd: this.defaultCwd, locked: false } };
    }
  }
}
