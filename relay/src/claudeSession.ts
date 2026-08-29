import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { ContextUsage, ModelChoice, PermissionMode } from "./sessionStore.js";

// Um turno = um processo `claude -p`. Continuidade entre turnos vem de
// `--resume <session_id>`, não de manter um processo vivo — ver
// docs/10-stream-json-validacao.md e docs/11.
//
// ANTHROPIC_API_KEY é sempre removida do ambiente do processo filho: é a
// regra de ouro do projeto (docs/00) — se essa env var vazar, o Claude Code
// passa a cobrar por API em vez de usar o plano.
//
// Caminho absoluto e PATH explícito: rodando via systemd o processo não tem
// o PATH do shell interativo do usuário (não sourca .bashrc/.profile), então
// nem o binário nem ferramentas que ele invoca internamente (node, git...)
// seriam encontrados só pelo nome — mesma classe de bug que já corrigimos
// pro tmux em docs/08.
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "/home/user/.local/bin/claude";
// `relay/scripts` (não `dist/` nem `src/`) — o helper é um script bash
// standalone, não precisa de build, e fica no PATH pro turno achar
// `ultron-bg` só pelo nome (ver docs/32).
const EXTRA_PATH_DIRS = [
  "/home/user/.local/bin",
  "/home/user/.nvm/versions/node/v20.19.0/bin",
  "/home/user/personal/ultron/relay/scripts",
];

/** Anexado em todo turno, independente do CLAUDE.md do projeto ativo — é uma
 * preferência do CLIENTE ultron, não de um projeto específico. Sem isso, ao
 * escrever um rascunho pra colar em outro lugar (Slack, e-mail), o modelo
 * às vezes quebra o texto manualmente a cada ~80 colunas (hábito herdado de
 * texto de terminal/commit) — dentro de um bloco ``` isso é literal (`pre`
 * preserva `\n`), então em vez de um parágrafo fluido que a UI quebra
 * sozinha pela largura da tela, sobra um parágrafo com quebras de linha no
 * meio de frases. Texto enxuto de propósito (~1/3 do original) — isso entra
 * em TODO turno mesmo quando não tem nada a ver com rascunho de texto, então
 * o custo de token do reforço mais explícito não valia a pena até aparecer
 * de novo na prática. Se voltar a acontecer, dá pra reforçar mesmo custando
 * mais tokens.
 *
 * Segundo parágrafo: cada turno é um processo `claude -p` novo (comentário do topo do arquivo)
 * — o registro interno que sustenta `run_in_background`/`BashOutput` vive só
 * na memória DESSE processo e some quando o turno termina. Sem este aviso,
 * o modelo promete "vou rodar em background e te aviso quando terminar"
 * usando esse mecanismo nativo (ou `&`/`nohup` cru) e a promessa nunca se
 * cumpre — achado real do usuário, causa raiz documentada em docs/32.
 * `ultron-bg` (script em `relay/scripts/`, incluído no PATH acima) resolve
 * isso ficando fora do processo do turno; o `BackgroundJobTracker`
 * (`backgroundJobs.ts`, ligado em `sessionManager.ts`) observa a conclusão e
 * dispara um turno de follow-up automático (`SharedSession.
 * submitBackgroundJobResult`, docs/32 Fase D) — a promessa abaixo já é
 * cumprida de verdade, validada ponta-a-ponta contra o binário real
 * (`relay/test-background-job.mjs`).
 */
const APPEND_SYSTEM_PROMPT =
  "When writing prose meant to be pasted elsewhere (Slack, email), write each paragraph as one " +
  "continuous line, not manually wrapped at a fixed width.\n\n" +
  "For any command that will keep running after this turn ends (a build, a long test suite, " +
  "anything whose result matters later) and is worth tracking, launch it with `ultron-bg start " +
  '--label "<short description>" --cmd "<full shell command>"` — check on it within this same ' +
  "turn with `ultron-bg status <id>` if useful. Never use `&`, `nohup`, or the Bash tool's own " +
  "`run_in_background` for this: none of those survive past this turn, so any promise to 'check " +
  "back' or 'let you know' made through them is always broken. Once launched with `ultron-bg`, " +
  "you don't need to wait for it or keep polling before ending your turn — when it finishes, you " +
  "will automatically get a new turn reporting the result, which the user is notified about. You " +
  "can tell them that.";

/** Env de todo processo filho do relay (turno do `claude -p` aqui, shell
 * interativo em terminalSession.ts) — extraído pra um lugar só porque a
 * regra de ouro (nunca deixar `ANTHROPIC_API_KEY` vazar pro processo filho,
 * docs/00) tem que valer igual nos dois: um terminal aberto pelo usuário é
 * tão capaz de rodar `claude` manualmente quanto o próprio spawn do turno. */
export function buildChildEnv(homeOverride: string | undefined): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  if (homeOverride) {
    env.HOME = homeOverride;
  }
  env.PATH = [...EXTRA_PATH_DIRS, env.PATH ?? ""].join(":");
  return env;
}

export interface ClaudeEvent {
  type: string;
  session_id?: string;
  is_error?: boolean;
  result?: string;
  errors?: string[];
  [key: string]: unknown;
}

export interface ClaudeSessionOptions {
  /** Sobrescreve $HOME do processo filho — usado pro isolamento por perfil (docs/08). */
  homeOverride?: string;
  /** Semeia o session_id a partir do que a Fase 7 persistiu em disco — ver
   * SessionStore/docs/18. Sem isso, um restart do relay perdia a
   * continuidade de `--resume` mesmo com a sessão do Claude Code intacta. */
  initialSessionId?: string;
}

export interface SendTurnResult {
  /** `true` quando o turno terminou porque `stop()` foi chamado, não porque
   * o `claude` de fato concluiu ou deu erro. */
  stopped: boolean;
  /** `undefined` se o turno não chegou a produzir um `result` com os campos
   * esperados (ex: erro antes de qualquer chamada de API) — nesse caso quem
   * chama deve manter o último valor conhecido, não zerar. */
  contextUsage?: ContextUsage;
  /** Texto da última resposta do assistente no fio principal (não inclui
   * subagentes, mesmo filtro de `isMainThreadEvent`) — usado só pra alimentar
   * o gerador de sugestão de próxima mensagem (suggestionGenerator.ts).
   * `undefined` se o turno não produziu nenhum bloco de texto (ex: só
   * tool_use antes de interromper). */
  lastAssistantText?: string;
}

interface ContentBlock {
  type?: string;
  text?: string;
}

interface ResultUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface ModelUsageEntry {
  contextWindow?: number;
}

function usageTokenTotal(usage: ResultUsage): number {
  return (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
}

/**
 * `true` só pro evento `assistant` do fio principal da conversa — subagentes
 * (`Task`) também emitem eventos `assistant` no mesmo stdout, mas com
 * `parent_tool_use_id` apontando pro `tool_use` que os disparou (confirmado
 * rodando um turno real com um subagente: o evento dele tinha
 * `cache_read_input_tokens: 0` — contexto isolado, começando do zero — bem
 * diferente do fio principal). Sem esse filtro, o usage de um subagente
 * (que pode ler arquivos grandes por conta própria) contamina o número do
 * fio principal.
 */
export function isMainThreadEvent(event: ClaudeEvent): boolean {
  return event.parent_tool_use_id === null || event.parent_tool_use_id === undefined;
}

/**
 * Monta o uso de contexto a partir de duas fontes complementares: `usage`
 * vem do ÚLTIMO evento `assistant` do fio principal visto no turno (uma
 * única resposta da Messages API — mesma semântica do `current_usage`
 * oficial do statusline do Claude Code), e `contextWindowSize` vem de
 * `modelUsage[model]` no evento `result` de fim de turno — dado real do CLI
 * pra aquela conta (ex: contexto estendido de 1M), nunca uma tabela
 * estática nossa.
 *
 * Importante: os campos de nível superior do próprio `result.usage` (e o
 * `result.usage.iterations`) são agregados que somam TUDO que rodou no
 * turno, incluindo subagentes — testado contra uma sessão real e contra um
 * turno com subagente, os dois infladavam o total muito além do que o fio
 * principal realmente tinha em contexto (>100% numa sessão que não tinha
 * nem 40% do limite de verdade usado). Por isso este código nunca lê
 * `result.usage` pra tokens — só pro `modelUsage` (que é uma propriedade
 * estática do modelo, não um contador, e não sofre desse problema).
 */
export function extractContextUsage(
  resultEvent: ClaudeEvent,
  model: string | undefined,
  lastMainThreadUsage: ResultUsage | undefined,
): ContextUsage | undefined {
  if (!lastMainThreadUsage) return undefined;
  const modelUsage = resultEvent.modelUsage as Record<string, ModelUsageEntry> | undefined;
  if (!modelUsage) return undefined;
  const modelKey = (model && model in modelUsage ? model : undefined) ?? Object.keys(modelUsage)[0];
  const entry = modelKey ? modelUsage[modelKey] : undefined;
  if (!modelKey || !entry?.contextWindow) return undefined;
  return {
    model: modelKey,
    contextWindowSize: entry.contextWindow,
    usedTokens: usageTokenTotal(lastMainThreadUsage),
  };
}

export class ClaudeSession {
  private sessionId: string | undefined;
  private currentChild: ChildProcessWithoutNullStreams | undefined;
  private stopRequested = false;

  constructor(private readonly options: ClaudeSessionOptions = {}) {
    this.sessionId = options.initialSessionId;
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }

  /** `/clear` (docs/26) — não roda nada no `claude`, só solta a continuidade
   * local: o próximo `sendTurn` não leva `--resume`, então começa uma
   * conversa nova de verdade no lado da CLI, sem gastar processo/turno só
   * pra "avisar" ela disso. */
  resetSessionId(): void {
    this.sessionId = undefined;
  }

  /**
   * Interrompe o turno em andamento, se houver — usado pelo botão "Parar" no
   * cliente. Testado direto contra o binário: `claude -p` captura `SIGINT` e
   * sai com código 0 (não morre "cru"), inclusive mandando um `result` final
   * com `session_id` válido mesmo quando interrompido no meio do streaming
   * — `sendTurn` usa `stopRequested` pra não tratar isso como erro de
   * verdade (o que apagaria a continuidade da sessão à toa).
   */
  stop(): boolean {
    if (!this.currentChild) return false;
    this.stopRequested = true;
    this.currentChild.kill("SIGINT");
    return true;
  }

  async sendTurn(
    text: string,
    cwd: string,
    permissionMode: PermissionMode,
    model: ModelChoice | undefined,
    onEvent: (event: ClaudeEvent) => void,
  ): Promise<SendTurnResult> {
    this.stopRequested = false;
    const args = [
      "-p",
      text,
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--append-system-prompt",
      APPEND_SYSTEM_PROMPT,
      ...(model ? ["--model", model] : []),
      // `bypassPermissions` é o modo padrão histórico (o único que existia
      // antes de o modo ser selecionável, ver docs/25) — continua na flag
      // dedicada porque é a forma testada contra o binário real de evitar
      // que uma ferramenta tocando um caminho novo (ex: imagem recém-
      // enviada) fique presa pedindo aprovação que ninguém pode dar num
      // processo não-interativo (achado real testando upload de imagem,
      // docs/15). Os outros modos vão direto na flag genérica — headless sem
      // `--permission-prompt-tool` nunca trava esperando aprovação: a ação
      // é só negada e o Claude segue trabalhando (doc oficial, ver docs/25).
      ...(permissionMode === "bypassPermissions"
        ? ["--dangerously-skip-permissions"]
        : ["--permission-mode", permissionMode]),
    ];
    // Se um `--resume` anterior tiver falhado (sessão inválida, histórico
    // não encontrado etc.), sessionId já foi limpo abaixo — a próxima
    // chamada começa uma conversa nova automaticamente em vez de repetir
    // o mesmo erro pra sempre.
    if (this.sessionId) {
      args.push("--resume", this.sessionId);
    }

    const child = spawn(CLAUDE_BIN, args, {
      env: buildChildEnv(this.options.homeOverride),
      cwd,
    });
    this.currentChild = child;

    try {
      const spawnError = new Promise<never>((_, reject) => {
        child.on("error", (error) => reject(error));
      });

      let stderrOutput = "";
      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderrOutput += text;
        console.error("[relay] claude stderr:", text);
      });

      let eventCount = 0;
      let lastErrorResult: string | undefined;
      let lastModel: string | undefined;
      let lastMainThreadUsage: ResultUsage | undefined;
      let contextUsage: ContextUsage | undefined;
      let lastAssistantText: string | undefined;

      const readLines = (async () => {
        const rl = createInterface({ input: child.stdout });
        for await (const line of rl) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as ClaudeEvent;
          eventCount++;
          if (event.type === "system" && event.subtype === "init" && typeof event.model === "string") {
            lastModel = event.model;
          }
          if (event.type === "assistant" && isMainThreadEvent(event)) {
            const message = event.message as { usage?: ResultUsage; content?: ContentBlock[] } | undefined;
            if (message?.usage) lastMainThreadUsage = message.usage;
            // Sobrescreve a cada evento assistant do fio principal — o
            // último antes do `result` é a resposta final que o usuário viu,
            // que é o que interessa pro gerador de sugestão (não precisa
            // acumular todas as respostas intermediárias do turno).
            const textBlocks = message?.content?.filter((block) => block.type === "text" && block.text);
            if (textBlocks && textBlocks.length > 0) {
              lastAssistantText = textBlocks.map((block) => block.text).join("\n");
            }
          }
          if (event.type === "result") {
            // Capturado sempre que presente, erro ou não — um turno
            // interrompido por `stop()` ainda manda um `result` com
            // `session_id` válido (testado contra o binário real), e sem
            // isso a continuidade da sessão se perdia à toa num stop.
            if (typeof event.session_id === "string") this.sessionId = event.session_id;
            if (event.is_error) {
              lastErrorResult =
                event.errors?.join("; ") || event.result || "erro desconhecido retornado pelo claude";
            }
            contextUsage = extractContextUsage(event, lastModel, lastMainThreadUsage) ?? contextUsage;
          }
          onEvent(event);
        }
      })();

      const exitCode = await new Promise<number | null>((resolve) => {
        child.on("close", (code) => resolve(code));
      });

      await Promise.race([spawnError, readLines]);

      if (lastErrorResult) {
        if (this.stopRequested) return { stopped: true, contextUsage, lastAssistantText };
        this.sessionId = undefined;
        throw new Error(lastErrorResult);
      }
      if (eventCount === 0 || exitCode !== 0) {
        if (this.stopRequested) return { stopped: true, contextUsage, lastAssistantText };
        this.sessionId = undefined;
        throw new Error(
          stderrOutput.trim() || `claude saiu com código ${String(exitCode)} sem produzir nenhum evento`,
        );
      }
      return { stopped: false, contextUsage, lastAssistantText };
    } finally {
      this.currentChild = undefined;
    }
  }
}
