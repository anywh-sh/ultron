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
  /** `null` até o título ser inferido do primeiro prompt (ou definido por um
   * rename manual) — enquanto `null`, a sessão existe (cwd/lock já podem
   * estar em uso) mas não aparece em `listTitled()`/`GET /sessions`, que é o
   * que mantém a sidebar em branco até lá. Ver SessionManager.createSession
   * (gatilho) e titleGenerator.ts (geração). */
  title: string | null;
  cwd: SessionCwdState;
}

export type SessionRecord = Record<string, SessionEntry>;

/** Shape anterior a essa mudança: id -> { session_id, cwd/lock }, sem
 * `title` — o id em si já era o "nome" mostrado na UI. Usado só pra migrar
 * arquivos gravados antes da feature de título/rename. */
type PreTitleSessionRecord = Record<string, { sessionId: string | null; cwd: SessionCwdState }>;

function isPreTitleRecord(value: object): value is PreTitleSessionRecord {
  return Object.values(value).every(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      !("title" in entry) &&
      "sessionId" in entry &&
      "cwd" in entry,
  );
}

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
        // Nome antigo vira id E título inicial: sessão já existente não
        // precisa (nem deve) gerar um título novo, ela já tinha um nome útil.
        migrated[name] = { sessionId, title: name, cwd: { cwd: this.defaultCwd, locked: sessionId !== null } };
      }
      return migrated;
    }

    if (isPreTitleRecord(parsed)) {
      this.migrated = true;
      const migrated: SessionRecord = {};
      for (const [id, entry] of Object.entries(parsed)) {
        migrated[id] = { ...entry, title: id };
      }
      return migrated;
    }

    return parsed as SessionRecord;
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.records, null, 2));
  }

  /** Todos os ids conhecidos, titulados ou não — usado só pra materializar
   * as `SharedSession` em memória no boot (SessionManager), que precisam
   * existir mesmo pra uma sessão ainda sem título (cwd/lock/session_id já
   * podem estar em uso). */
  listIds(): string[] {
    return Object.keys(this.records);
  }

  /** Só as sessões já tituladas — é isso que `GET /sessions` expõe, o que
   * mantém a sidebar em branco até o primeiro prompt (ou um rename manual)
   * dar um título à sessão. */
  listTitled(): { id: string; title: string }[] {
    return Object.entries(this.records)
      .filter((entry): entry is [string, SessionEntry & { title: string }] => entry[1].title !== null)
      .map(([id, entry]) => ({ id, title: entry.title }));
  }

  getSessionId(id: string): string | undefined {
    return this.records[id]?.sessionId ?? undefined;
  }

  getTitle(id: string): string | null {
    return this.records[id]?.title ?? null;
  }

  /** Idempotente — garante que o id já exista (sem título ainda) mesmo
   * antes do primeiro turno terminar (e portanto antes de termos um
   * session_id de verdade pra ele). */
  recordId(id: string): void {
    if (id in this.records) return;
    this.records[id] = { sessionId: null, title: null, cwd: { cwd: this.defaultCwd, locked: false } };
    this.persist();
  }

  /** Usado tanto pra gravar o título inferido do primeiro prompt quanto pra
   * um rename manual — nos dois casos é só "o título de agora é este". */
  setTitle(id: string, title: string): void {
    this.ensureEntry(id);
    this.records[id].title = title;
    this.persist();
  }

  recordSessionId(id: string, sessionId: string): void {
    this.ensureEntry(id);
    this.records[id].sessionId = sessionId;
    this.persist();
  }

  getCwdState(id: string): SessionCwdState {
    return this.records[id]?.cwd ?? { cwd: this.defaultCwd, locked: false };
  }

  setCwd(id: string, cwd: string): void {
    this.ensureEntry(id);
    this.records[id].cwd.cwd = cwd;
    this.persist();
  }

  lockCwd(id: string): void {
    this.ensureEntry(id);
    this.records[id].cwd.locked = true;
    this.persist();
  }

  private ensureEntry(id: string): void {
    if (!(id in this.records)) {
      this.records[id] = { sessionId: null, title: null, cwd: { cwd: this.defaultCwd, locked: false } };
    }
  }
}
