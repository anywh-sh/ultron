import { spawn } from "node:child_process";
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
  [key: string]: unknown;
}

export interface ClaudeSessionOptions {
  /** Sobrescreve $HOME do processo filho — usado pro isolamento por perfil (docs/08). */
  homeOverride?: string;
}

export class ClaudeSession {
  private sessionId: string | undefined;

  constructor(private readonly options: ClaudeSessionOptions = {}) {}

  async sendTurn(text: string, onEvent: (event: ClaudeEvent) => void): Promise<void> {
    const args = [
      "-p",
      text,
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
    ];
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
      cwd: this.options.homeOverride,
    });

    const spawnError = new Promise<never>((_, reject) => {
      child.on("error", (error) => reject(error));
    });

    child.stderr.on("data", (chunk: Buffer) => {
      console.error("[relay] claude stderr:", chunk.toString());
    });

    const readLines = (async () => {
      const rl = createInterface({ input: child.stdout });
      for await (const line of rl) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as ClaudeEvent;
        if (event.type === "result" && typeof event.session_id === "string") {
          this.sessionId = event.session_id;
        }
        onEvent(event);
      }
    })();

    const closed = new Promise<void>((resolve) => {
      child.on("close", () => resolve());
    });

    await Promise.race([spawnError, Promise.all([readLines, closed])]);
  }
}
