import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

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
const EXTRA_PATH_DIRS = ["/home/user/.local/bin", "/home/user/.nvm/versions/node/v20.19.0/bin"];

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

  async sendTurn(text: string, cwd: string, onEvent: (event: ClaudeEvent) => void): Promise<SendTurnResult> {
    this.stopRequested = false;
    const args = [
      "-p",
      text,
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      // Mesmo modo que o usuário já usa nos dois perfis interativos
      // (alias `claude`/`claude-comp`, ver docs/08) — sem isso, qualquer
      // ferramenta tocando um caminho novo (ex: imagem recém-enviada)
      // fica presa pedindo aprovação que ninguém pode dar num processo
      // não-interativo (achado real testando upload de imagem, docs/15).
      "--dangerously-skip-permissions",
    ];
    // Se um `--resume` anterior tiver falhado (sessão inválida, histórico
    // não encontrado etc.), sessionId já foi limpo abaixo — a próxima
    // chamada começa uma conversa nova automaticamente em vez de repetir
    // o mesmo erro pra sempre.
    if (this.sessionId) {
      args.push("--resume", this.sessionId);
    }

    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    if (this.options.homeOverride) {
      env.HOME = this.options.homeOverride;
    }
    env.PATH = [...EXTRA_PATH_DIRS, env.PATH ?? ""].join(":");

    const child = spawn(CLAUDE_BIN, args, {
      env,
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

      const readLines = (async () => {
        const rl = createInterface({ input: child.stdout });
        for await (const line of rl) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as ClaudeEvent;
          eventCount++;
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
          }
          onEvent(event);
        }
      })();

      const exitCode = await new Promise<number | null>((resolve) => {
        child.on("close", (code) => resolve(code));
      });

      await Promise.race([spawnError, readLines]);

      if (lastErrorResult) {
        if (this.stopRequested) return { stopped: true };
        this.sessionId = undefined;
        throw new Error(lastErrorResult);
      }
      if (eventCount === 0 || exitCode !== 0) {
        if (this.stopRequested) return { stopped: true };
        this.sessionId = undefined;
        throw new Error(
          stderrOutput.trim() || `claude saiu com código ${String(exitCode)} sem produzir nenhum evento`,
        );
      }
      return { stopped: false };
    } finally {
      this.currentChild = undefined;
    }
  }
}
