import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

// Prototipo (milestone 1 do relay): um turno = um processo `claude -p`.
// Continuidade entre turnos vem de `--resume <session_id>`, não de manter
// um processo vivo — ver docs/10-stream-json-validacao.md e docs/11.
//
// ANTHROPIC_API_KEY é sempre removida do ambiente do processo filho: é a
// regra de ouro do projeto (docs/00) — se essa env var vazar, o Claude Code
// passa a cobrar por API em vez de usar o plano.

export interface ClaudeEvent {
  type: string;
  session_id?: string;
  [key: string]: unknown;
}

export class ClaudeSession {
  private sessionId: string | undefined;

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

    const child = spawn("claude", args, { env });

    child.stderr.on("data", (chunk: Buffer) => {
      console.error("[relay] claude stderr:", chunk.toString());
    });

    const rl = createInterface({ input: child.stdout });
    for await (const line of rl) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as ClaudeEvent;
      if (event.type === "result" && typeof event.session_id === "string") {
        this.sessionId = event.session_id;
      }
      onEvent(event);
    }

    await new Promise<void>((resolve) => {
      child.on("close", () => resolve());
    });
  }
}
