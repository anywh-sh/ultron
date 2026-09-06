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

/** Espelha os valores aceitos por `claude --permission-mode` que expomos na
 * UI (docs/25) — `bypassPermissions` é o único que ainda usa a flag
 * histórica `--dangerously-skip-permissions` (claudeSession.ts), as outras
 * três vão de `--permission-mode <valor>` direto. `auto`/`dontAsk` ficaram
 * de fora de propósito: `auto` depende de elegibilidade de plano/modelo e
 * roda um classifier por trás (custo/escopo próprios), `dontAsk` é pensado
 * pra CI com allowlist pré-definida, não pra chat interativo. */
export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions";

/** Espelha os aliases que `claude --model` aceita, curados do mesmo jeito
 * que `PermissionMode` (docs/25): as variantes de contexto estendido
 * (`sonnet[1m]` etc.) e `opusplan` ficam de fora por enquanto, exigem
 * explicação própria que não foi pedida ainda. */
export type ModelChoice = "default" | "sonnet" | "opus" | "haiku" | "fable";

/** Uso de contexto do turno mais recente de uma sessão — ver ClaudeSession
 * (quem extrai isso do evento `result` do `claude -p`) e o plano do
 * indicador de janela de contexto. `contextWindowSize` vem direto do CLI
 * (`modelUsage[model].contextWindow`), não de uma tabela estática nossa —
 * assim continua certo pra contas com contexto estendido (1M) sem precisar
 * saber disso de antemão. */
export interface ContextUsage {
  /** Modelo resolvido nesse turno (ex. "claude-sonnet-5"). */
  model: string;
  contextWindowSize: number;
  /** `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`
   * do `result.usage` — mesma fórmula que a doc oficial do Claude Code usa
   * pro `used_percentage` do statusline (exclui `output_tokens` de
   * propósito). */
  usedTokens: number;
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
  /** Timestamp (epoch ms) do último turno enviado — é o que ordena
   * `listTitled()`. Atualizado a cada turno, não só no primeiro (ver
   * `touch`), pra reabrir uma sessão antiga e conversar com ela subir pro
   * topo da sidebar. Nunca `null`: criação/migração já semeia com o
   * timestamp de agora, então uma sessão recém-criada ainda entra ordenada
   * (não precisa de "nunca interagida" como caso especial). */
  lastActiveAt: number;
  /** Opcional pra tolerar registros gravados antes dessa feature — lidos
   * como `"bypassPermissions"` (ver `getPermissionMode`), que é o
   * comportamento hardcoded que todo mundo já tinha antes de existir modo
   * selecionável. Diferente de `cwd`, não trava depois do primeiro turno —
   * o modo pode mudar a qualquer momento da conversa. */
  permissionMode?: PermissionMode;
  /** Opcional: `undefined` (nunca escolhido via `/model`) significa "não
   * passa `--model` no spawn", igual o comportamento de sempre antes dessa
   * feature existir — diferente de `permissionMode`, não tem um valor
   * hardcoded de fallback, porque "deixar o CLI decidir seu próprio padrão"
   * já É o comportamento padrão. Mesma regra de "não trava depois do
   * primeiro turno" do `permissionMode`. */
  model?: ModelChoice;
  /** Opcional pelo mesmo motivo de `permissionMode`: tolera registros
   * gravados antes dessa feature existir. Nunca reconstruído a partir do
   * `.jsonl` do Claude Code num restart — o evento `result` (única fonte do
   * limite real por modelo) só existe no stdout ao vivo do `claude -p`,
   * nunca é persistido no transcript. Por isso precisa ser gravado aqui a
   * cada turno, senão some pro cliente até o próximo turno rodar. */
  contextUsage?: ContextUsage;
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

/** Shape anterior a essa mudança: já tem `title`, mas não `lastActiveAt` —
 * arquivos gravados entre a feature de título/rename e a de ordenação por
 * última interação. */
type PreActivitySessionRecord = Record<string, { sessionId: string | null; title: string | null; cwd: SessionCwdState }>;

function isPreActivityRecord(value: object): value is PreActivitySessionRecord {
  return Object.values(value).every(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      "title" in entry &&
      !("lastActiveAt" in entry),
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

    // Um só timestamp pra todo o lote de migração (não `Date.now()` por
    // entrada): mantém as sessões existentes empatadas na ordenação por
    // `lastActiveAt`, e o `Array.sort` estável do V8 preserva a ordem
    // original (inserção) entre empates — não embaralha a lista existente.
    const migrationNow = Date.now();

    if (isLegacyRecord(parsed)) {
      this.migrated = true;
      const migrated: SessionRecord = {};
      for (const [name, sessionId] of Object.entries(parsed)) {
        // Sessão que já tinha session_id de verdade já tem histórico
        // gravado sob o cwd implícito de então (homeOverride ?? homedir()) —
        // trata como já travada, pra não arriscar quebrar o --resume dela.
        // Nome antigo vira id E título inicial: sessão já existente não
        // precisa (nem deve) gerar um título novo, ela já tinha um nome útil.
        migrated[name] = {
          sessionId,
          title: name,
          cwd: { cwd: this.defaultCwd, locked: sessionId !== null },
          lastActiveAt: migrationNow,
        };
      }
      return migrated;
    }

    if (isPreTitleRecord(parsed)) {
      this.migrated = true;
      const migrated: SessionRecord = {};
      for (const [id, entry] of Object.entries(parsed)) {
        migrated[id] = { ...entry, title: id, lastActiveAt: migrationNow };
      }
      return migrated;
    }

    if (isPreActivityRecord(parsed)) {
      this.migrated = true;
      const migrated: SessionRecord = {};
      for (const [id, entry] of Object.entries(parsed)) {
        migrated[id] = { ...entry, lastActiveAt: migrationNow };
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
   * dar um título à sessão. Ordenado por última interação (mais recente
   * primeiro) — reabrir uma sessão antiga e conversar com ela sobe pro topo. */
  listTitled(): { id: string; title: string }[] {
    return Object.entries(this.records)
      .filter((entry): entry is [string, SessionEntry & { title: string }] => entry[1].title !== null)
      .sort(([, a], [, b]) => b.lastActiveAt - a.lastActiveAt)
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
    this.records[id] = { sessionId: null, title: null, cwd: { cwd: this.defaultCwd, locked: false }, lastActiveAt: Date.now() };
    this.persist();
  }

  /** Chamado a cada turno enviado (não só no primeiro) — é o que faz uma
   * sessão antiga voltar pro topo da sidebar ao ser usada de novo. */
  touch(id: string): void {
    this.ensureEntry(id);
    this.records[id].lastActiveAt = Date.now();
    this.persist();
  }

  /** `true` se a sessão existia (e foi removida); `false` se já não existia.
   * Só tira do controle do ultron — não mexe no transcript que o Claude
   * Code já mantém sozinho em `~/.claude/projects/`. */
  deleteEntry(id: string): boolean {
    if (!(id in this.records)) return false;
    delete this.records[id];
    this.persist();
    return true;
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

  /** `/clear` (docs/26) — solta a continuidade gravada, senão um restart do
   * relay voltaria a dar `--resume` na conversa que o usuário já limpou. */
  clearSessionId(id: string): void {
    this.ensureEntry(id);
    this.records[id].sessionId = null;
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

  /** `/clear` (ver `SharedSession.clearConversation`) — contraparte de
   * `lockCwd`, senão um restart do relay voltaria a carregar a sessão como
   * travada mesmo depois do destravamento. */
  unlockCwd(id: string): void {
    this.ensureEntry(id);
    this.records[id].cwd.locked = false;
    this.persist();
  }

  getPermissionMode(id: string): PermissionMode {
    return this.records[id]?.permissionMode ?? "bypassPermissions";
  }

  setPermissionMode(id: string, mode: PermissionMode): void {
    this.ensureEntry(id);
    this.records[id].permissionMode = mode;
    this.persist();
  }

  getModel(id: string): ModelChoice | undefined {
    return this.records[id]?.model;
  }

  setModel(id: string, model: ModelChoice): void {
    this.ensureEntry(id);
    this.records[id].model = model;
    this.persist();
  }

  getContextUsage(id: string): ContextUsage | undefined {
    return this.records[id]?.contextUsage;
  }

  setContextUsage(id: string, usage: ContextUsage): void {
    this.ensureEntry(id);
    this.records[id].contextUsage = usage;
    this.persist();
  }

  private ensureEntry(id: string): void {
    if (!(id in this.records)) {
      this.records[id] = {
        sessionId: null,
        title: null,
        cwd: { cwd: this.defaultCwd, locked: false },
        lastActiveAt: Date.now(),
      };
    }
  }
}
