import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ClaudeEvent } from "./claudeSession.js";

// Fase C de docs/32 — rastreia jobs iniciados via `ultron-bg` (relay/scripts)
// fora do processo do turno, já que o registro interno do CLI pra
// `run_in_background`/`BashOutput` some junto com o `claude -p` daquele
// turno. Ainda não dispara nenhum turno de follow-up (Fase D) — só detecta
// o marcador de início e observa a conclusão via arquivo `.exit`, pra
// validar a detecção isoladamente antes de acoplar em qualquer coisa que
// afete o usuário.

export interface BackgroundJobStarted {
  id: string;
  pid: number;
  log: string;
  exitFile: string;
  label: string;
}

export interface WatchedJob {
  sessionId: string;
  id: string;
  label: string;
  logPath: string;
  exitPath: string;
  startedAt: number;
  /** PID reportado pelo `ultron-bg start` (Fase F de docs/32) — só usado
   * pra cancelamento (`cancel`, `kill -<pid>` no grupo de processo inteiro),
   * NUNCA pra detectar conclusão (isso é papel do arquivo `.exit`; reuso de
   * PID pelo SO mascararia um job morto como "ainda rodando"). `setsid` faz
   * esse PID ser ao mesmo tempo o PID/PGID/SID do processo — confirmado na
   * prática (docs/32, Fase A) —, então sinalizar o grupo (`-pid`) alcança
   * tudo que o comando gerou, não só o processo raiz. */
  pid: number;
}

/** Subconjunto de `WatchedJob` seguro pra expor ao cliente (Fase E de
 * docs/32) — sem `logPath`/`exitPath` (caminhos de arquivo no servidor,
 * detalhe interno) nem `sessionId` (já implícito na conexão WS da sessão). */
export interface BackgroundJobSummary {
  id: string;
  label: string;
  startedAt: number;
}

export function toBackgroundJobSummary(job: WatchedJob): BackgroundJobSummary {
  return { id: job.id, label: job.label, startedAt: job.startedAt };
}

export interface FinishedBackgroundJob extends WatchedJob {
  exitCode: number;
  logTail: string;
}

// Só a linha de marcador (uma das potencialmente várias linhas de stdout de
// uma chamada Bash) — não assume que é a string inteira, então sobrevive a
// eventual saída extra antes/depois dela.
const MARKER_RE = /\{"ultron_bg":"started".*\}/;

/**
 * Parser puro (sem I/O) do marcador que `ultron-bg start` imprime — separado
 * de `extractStartedJobFromEvent` pra poder testar contra strings soltas sem
 * precisar montar um `ClaudeEvent` inteiro.
 */
export function parseStartedMarker(text: string): BackgroundJobStarted | undefined {
  const match = MARKER_RE.exec(text);
  if (!match) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const { ultron_bg, id, pid, log, exitFile, label } = parsed as Record<string, unknown>;
  if (
    ultron_bg !== "started" ||
    typeof id !== "string" ||
    typeof pid !== "number" ||
    typeof log !== "string" ||
    typeof exitFile !== "string" ||
    typeof label !== "string"
  ) {
    return undefined;
  }
  return { id, pid, log, exitFile, label };
}

interface ToolResultBlock {
  type?: string;
  content?: unknown;
}

interface TextBlock {
  type?: string;
  text?: unknown;
}

/**
 * Shape real de um evento de `tool_result` no stream-json (confirmado
 * rodando `claude -p` de verdade, docs/32 Fase C): `type: "user"`,
 * `message.content` é um array de blocos; o que interessa aqui tem
 * `type: "tool_result"` e `content` — string na maioria dos casos vistos,
 * mas a API também permite um array de blocos de texto, então os dois são
 * tratados.
 */
function collectToolResultTexts(event: ClaudeEvent): string[] {
  if (event.type !== "user") return [];
  const message = event.message as { content?: unknown } | undefined;
  const content = message?.content;
  if (!Array.isArray(content)) return [];
  const texts: string[] = [];
  for (const block of content as ToolResultBlock[]) {
    if (!block || block.type !== "tool_result") continue;
    if (typeof block.content === "string") {
      texts.push(block.content);
    } else if (Array.isArray(block.content)) {
      for (const inner of block.content as TextBlock[]) {
        if (inner?.type === "text" && typeof inner.text === "string") texts.push(inner.text);
      }
    }
  }
  return texts;
}

export function extractStartedJobFromEvent(event: ClaudeEvent): BackgroundJobStarted | undefined {
  for (const text of collectToolResultTexts(event)) {
    const job = parseStartedMarker(text);
    if (job) return job;
  }
  return undefined;
}

function readExitCode(exitPath: string): number {
  const raw = readFileSync(exitPath, "utf8").trim();
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : -1;
}

/** Só a cauda — mesmo padrão de truncamento de
 * `notificationSummaryGenerator.ts`/`suggestionGenerator.ts`, mas lendo só
 * os últimos `maxBytes` do arquivo em vez de carregar tudo pra memória (um
 * job barulhento pode gerar um log grande). */
function readLogTail(logPath: string, maxBytes: number): string {
  const size = statSync(logPath).size;
  const start = Math.max(0, size - maxBytes);
  const length = size - start;
  if (length === 0) return "";
  const fd = openSync(logPath, "r");
  try {
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, start);
    return buffer.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

export interface BackgroundJobTrackerOptions {
  /** Chamado quando um job observado termina — na Fase D dispara o turno de
   * follow-up (ver `sessionManager.ts`). */
  onFinished: (job: FinishedBackgroundJob) => void;
  /** Disparado sempre que a lista de jobs observados de uma sessão muda —
   * início, conclusão OU expiração pelo teto (`maxWatchMs`). Fase E de
   * docs/32: é o que alimenta o `background_job_state` que o cliente usa
   * pro indicador de UI ("existe um job rodando agora"). Só o `sessionId`
   * — quem consome busca a lista atual via `listWatchedForSession`, não
   * carrega o array pronto (evita o callback ficar desatualizado se duas
   * mudanças acontecerem em sequência antes de quem escuta reagir). */
  onChanged?: (sessionId: string) => void;
  /** ms entre polls do disco — separado em option (não constante) só pra
   * teste conseguir usar um intervalo curto sem depender do valor de
   * produção. */
  pollIntervalMs?: number;
  /** Teto de observação — job que nunca termina (ex: servidor de dev
   * deixado de propósito) para de ser observado depois disso, evita a lista
   * crescer sem limite. */
  maxWatchMs?: number;
  /** Cauda do log entregue em `FinishedBackgroundJob.logTail`. */
  logTailBytes?: number;
  /** Caminho pro arquivo de persistência (Fase F de docs/32) — se
   * informado, a lista de jobs observados sobrevive a um restart do relay:
   * gravada a cada mudança (mesmo padrão síncrono do `SessionStore`,
   * `writeFileSync` do estado inteiro), recarregada no construtor e o
   * polling retomado de onde parou. `undefined` (padrão dos testes) mantém
   * o comportamento só-em-memória de antes — sem isso um restart no meio de
   * um job perdia o rastreamento pra sempre (edge case #10 do plano). */
  persistPath?: string;
}

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_MAX_WATCH_MS = 6 * 60 * 60 * 1000;
const DEFAULT_LOG_TAIL_BYTES = 4000;

export class BackgroundJobTracker {
  private readonly jobs = new Map<string, WatchedJob>();
  private timer: NodeJS.Timeout | undefined;
  private readonly pollIntervalMs: number;
  private readonly maxWatchMs: number;
  private readonly logTailBytes: number;

  constructor(private readonly options: BackgroundJobTrackerOptions) {
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.maxWatchMs = options.maxWatchMs ?? DEFAULT_MAX_WATCH_MS;
    this.logTailBytes = options.logTailBytes ?? DEFAULT_LOG_TAIL_BYTES;

    if (this.options.persistPath) {
      for (const job of this.load(this.options.persistPath)) {
        this.jobs.set(`${job.sessionId}:${job.id}`, job);
      }
      // Um job pode ter terminado (ou expirado) enquanto o relay estava
      // fora do ar — não espera o primeiro `pollIntervalMs` pra descobrir,
      // resolve isso já no boot. `setImmediate` (não uma chamada síncrona
      // aqui dentro do construtor): achado real testando restart — quem
      // instancia isto (`SessionManager`) só atribui o próprio campo depois
      // que ESTE construtor retornar; um `onChanged`/`onFinished` disparado
      // síncrono demais via `pollOnce()` chegava no callback do
      // `SessionManager` ANTES dele terminar de guardar a referência do
      // tracker, e `this.backgroundJobs` (lá) ainda estava `undefined`.
      if (this.jobs.size > 0) {
        this.ensurePolling();
        setImmediate(() => this.pollOnce());
      }
    }
  }

  /** Nunca lança — arquivo ausente (primeira vez) ou corrompido só começa
   * vazio, mesmo padrão de `SessionStore.load`. */
  private load(persistPath: string): WatchedJob[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(persistPath, "utf8"));
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is WatchedJob =>
        typeof entry === "object" &&
        entry !== null &&
        typeof entry.sessionId === "string" &&
        typeof entry.id === "string" &&
        typeof entry.label === "string" &&
        typeof entry.logPath === "string" &&
        typeof entry.exitPath === "string" &&
        typeof entry.startedAt === "number" &&
        typeof entry.pid === "number",
    );
  }

  /** Grava o estado inteiro a cada mutação — mesmo padrão síncrono e sem
   * debounce do `SessionStore` (docs/18): mudanças de job são raras (início/
   * fim/cancelamento, nunca por poll tick), o custo de um `writeFileSync` a
   * mais não importa. No-op se `persistPath` não foi configurado. */
  private persist(): void {
    if (!this.options.persistPath) return;
    mkdirSync(dirname(this.options.persistPath), { recursive: true });
    writeFileSync(this.options.persistPath, JSON.stringify([...this.jobs.values()], null, 2));
  }

  /** Chamado com todo `ClaudeEvent` de todo turno (ver `SharedSession.runTurn`)
   * — no-op pra quase todos, só reage aos que carregam o marcador de início. */
  observeEvent(sessionId: string, event: ClaudeEvent): void {
    const started = extractStartedJobFromEvent(event);
    if (!started) return;
    const key = `${sessionId}:${started.id}`;
    if (this.jobs.has(key)) return;
    this.jobs.set(key, {
      sessionId,
      id: started.id,
      label: started.label,
      logPath: started.log,
      exitPath: started.exitFile,
      startedAt: Date.now(),
      pid: started.pid,
    });
    this.ensurePolling();
    this.persist();
    this.options.onChanged?.(sessionId);
  }

  listWatched(): WatchedJob[] {
    return [...this.jobs.values()];
  }

  listWatchedForSession(sessionId: string): WatchedJob[] {
    return [...this.jobs.values()].filter((job) => job.sessionId === sessionId);
  }

  private ensurePolling(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.pollOnce(), this.pollIntervalMs);
    this.timer.unref?.();
  }

  /** Público só pra teste poder disparar um poll sem esperar o intervalo
   * real — o `setInterval` em produção chama o mesmo método. */
  pollOnce(): void {
    const now = Date.now();
    for (const [key, job] of this.jobs) {
      if (now - job.startedAt > this.maxWatchMs) {
        console.warn(
          `[relay] background job "${job.label}" (${job.id}) expirou sem terminar depois de ${String(this.maxWatchMs)}ms — parando de observar`,
        );
        this.jobs.delete(key);
        this.persist();
        this.options.onChanged?.(job.sessionId);
        continue;
      }
      if (!existsSync(job.exitPath)) continue;
      this.jobs.delete(key);
      let exitCode: number;
      let logTail: string;
      try {
        exitCode = readExitCode(job.exitPath);
        logTail = readLogTail(job.logPath, this.logTailBytes);
      } catch (error) {
        console.error(`[relay] falha lendo resultado do background job "${job.label}" (${job.id}):`, error);
        this.persist();
        this.options.onChanged?.(job.sessionId);
        continue;
      }
      this.persist();
      this.options.onFinished({ ...job, exitCode, logTail });
      this.options.onChanged?.(job.sessionId);
    }
    if (this.jobs.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Fase F de docs/32 — cancelamento pela UI. Mata o GRUPO de processo
   * inteiro (`pid` negativo, alcança tudo que o comando gerou, não só o
   * processo raiz), não passa por `.exit`/`onFinished`: diferente de um job
   * que termina sozinho, quem cancelou já sabe que cancelou (clicou o
   * botão), um turno de follow-up automático resumindo "foi cancelado"
   * seria ruído redundante. `SIGTERM` primeiro (dá chance de limpar
   * arquivos temporários etc.), `SIGKILL` ~2s depois pra quem ignora o
   * primeiro — mesma prática padrão de ferramentas tipo `timeout(1)`.
   * Retorna `false` sem efeito nenhum se o job já não está mais sendo
   * observado (terminou sozinho ou já foi cancelado antes) — corrida
   * possível entre o usuário clicar "cancelar" e o poll seguinte achar o
   * `.exit`. */
  cancel(sessionId: string, jobId: string): boolean {
    const key = `${sessionId}:${jobId}`;
    const job = this.jobs.get(key);
    if (!job) return false;

    this.jobs.delete(key);
    this.persist();
    this.options.onChanged?.(sessionId);

    try {
      process.kill(-job.pid, "SIGTERM");
    } catch {
      // Grupo já não existe (job tinha acabado de terminar sozinho bem
      // nesse instante) — nada a matar, mas a lista já foi atualizada acima.
      return true;
    }
    setTimeout(() => {
      try {
        process.kill(-job.pid, "SIGKILL");
      } catch {
        // Já morreu com o SIGTERM — esperado na maioria dos casos.
      }
    }, 2000).unref();
    return true;
  }

  /** Só pra teste/shutdown — produção nunca precisa parar o poller enquanto
   * o processo estiver vivo. */
  stopPolling(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
