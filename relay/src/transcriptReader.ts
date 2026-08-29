import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { ClaudeEvent } from "./claudeSession.js";
import type { BroadcastMessage } from "./sharedSession.js";

/**
 * Uma linha do `.jsonl` que o Claude Code grava sozinho em
 * `~/.claude/projects/<projeto>/<session_id>.jsonl` — formato solto de
 * propósito (é o transcript interno dele, não um protocolo nosso, e tem
 * tipos de linha que nunca documentamos: `queue-operation`, `attachment`,
 * `last-prompt`, `mode`, `ai-title`, `permission-mode`, `agent-name`,
 * `pr-link`, `file-history-*`...). Só os campos que realmente usamos ficam
 * tipados; o resto é ignorado por design.
 */
export interface TranscriptLine {
  type: string;
  isMeta?: boolean;
  message?: { content?: unknown };
  [key: string]: unknown;
}

function isTextBlock(value: unknown): value is { type: "text"; text: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "text" &&
    typeof (value as { text?: unknown }).text === "string"
  );
}

/** Exportado — reaproveitado por `transcriptFork.ts` pra achar a mesma linha
 * "mensagem humana genuína" ao contar turnos pra truncar (docs/33). */
export function isToolResultOnly(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.length > 0 &&
    content.every((block) => typeof block === "object" && block !== null && (block as { type?: unknown }).type === "tool_result")
  );
}

/**
 * Extrai o texto de uma mensagem humana genuína — string direta, ou lista
 * com pelo menos um bloco de texto. `undefined` quando o registro não é
 * isso: feedback de `tool_result` (agentic loop, não digitado por ninguém)
 * ou ruído `isMeta` (reminders/caveats injetados pelo próprio Claude Code).
 *
 * Exportado — `transcriptFork.ts` (docs/33) usa o mesmo critério pra contar
 * turnos ao decidir onde cortar o arquivo na edição de mensagem.
 */
export function extractHumanText(line: TranscriptLine): string | undefined {
  if (line.isMeta) return undefined;
  const content = line.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content) && !isToolResultOnly(content)) {
    const textBlocks = content.filter(isTextBlock);
    if (textBlocks.length > 0) return textBlocks.map((block) => block.text).join("\n");
  }
  return undefined;
}

/**
 * Troca por `-` qualquer caractere fora de `[a-zA-Z0-9-]` — mesma
 * sanitização que o Claude Code usa pro nome da pasta em
 * `~/.claude/projects/`. Confirmado batendo contra pastas reais dos dois
 * perfis: `/home/user/personal/ultron/relay` -> `-home-user-personal-ultron-relay`,
 * `/home/user/.ultron-trabalho-home` -> `-home-user--ultron-trabalho-home`.
 */
export function sanitizeCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9-]/g, "-");
}

/** O Claude Code CLI deriva o nome da pasta do `cwd` real do processo
 * (`process.cwd()`, que o kernel já devolve sem componentes de symlink) —
 * sanitizar o `cwd` bruto sem resolver symlink primeiro faz essa conta bater
 * com uma pasta que não existe sempre que algum componente do caminho for
 * symlink (achado real: `~/.ultron-trabalho-home/mode` -> `~/mode`, sessões
 * do repo `widgets` calculavam `-home-user--ultron-trabalho-home-mode-widgets` em vez
 * da pasta de verdade, `-home-user-mode-widgets`). Cai pro `cwd` bruto se o
 * caminho não existir mais (sessão de teste/fixture, ou pasta apagada) —
 * mesmo comportamento de antes nesse caso, só sem tentar resolver o que não
 * dá. */
function resolveRealCwd(cwd: string): string {
  try {
    return realpathSync(cwd);
  } catch {
    return cwd;
  }
}

/** Exportado só pra teste — deixa o teste escrever a fixture no mesmo lugar
 * que o código real vai procurar, em vez de duplicar a regra de sanitização.
 * `home` e `cwd` já vêm resolvidos pelo caller (`SharedSession`, via
 * `paths.ts::defaultCwd` pro primeiro e o cwd de verdade da sessão pro
 * segundo) — cwd é por sessão desde a feature de working directory, não dá
 * mais pra assumir que é igual a `home`/`process.cwd()` aqui dentro. */
export function transcriptPath(home: string, cwd: string, sessionId: string): string {
  return join(home, ".claude", "projects", sanitizeCwd(resolveRealCwd(cwd)), `${sessionId}.jsonl`);
}

/**
 * Reconstrói o `history` de uma sessão a partir do transcript que o Claude
 * Code já mantém sozinho — usado quando o relay reinicia e perde o
 * `SharedSession.history` em memória (sempre foi só em memória, nunca
 * persistido). Tradução, não replay direto: ver docs/20-backlog.md e o
 * plano desta mudança pros motivos e a investigação por trás das regras
 * abaixo.
 */
export function readHistoryFromTranscript(home: string, cwd: string, sessionId: string): BroadcastMessage[] {
  const path = transcriptPath(home, cwd, sessionId);
  if (!existsSync(path)) return [];

  const messages: BroadcastMessage[] = [];
  let turnOpen = false;

  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    if (!rawLine.trim()) continue;

    let line: TranscriptLine;
    try {
      line = JSON.parse(rawLine) as TranscriptLine;
    } catch {
      // Só pode acontecer na última linha, se alguém reconectar no meio de
      // uma escrita — descarta em vez de quebrar o replay inteiro.
      continue;
    }

    if (line.type === "assistant") {
      const event: ClaudeEvent = { type: "assistant", message: line.message };
      messages.push({ type: "claude_event", event });
      continue;
    }

    if (line.type !== "user") continue; // resto é ruído sem representação visual (ver módulo).

    const humanText = extractHumanText(line);
    if (humanText !== undefined) {
      if (turnOpen) messages.push({ type: "turn_complete" });
      // Timestamp real da linha (docs/33) — o client usa isso pra mostrar
      // "há X min" em mensagens reconstruídas do disco; quem manda ao vivo já
      // sabe a própria hora do clique, não depende disso. Omitido (não
      // `undefined` explícito) quando a linha não tem `timestamp` — mantém a
      // forma do evento idêntica à de antes dessa feature existir nesse caso.
      const event: ClaudeEvent = {
        type: "user_prompt",
        message: { content: [{ type: "text", text: humanText }] },
        ...(typeof line.timestamp === "string" ? { timestamp: line.timestamp } : {}),
      };
      messages.push({ type: "claude_event", event });
      turnOpen = true;
      continue;
    }

    if (isToolResultOnly(line.message?.content)) {
      const event: ClaudeEvent = { type: "user", message: line.message };
      messages.push({ type: "claude_event", event });
    }
    // `isMeta` ou formato inesperado: ignora, sem representação visual.
  }

  // Turno aberto no fim do arquivo não é fechado de propósito — pode estar
  // genuinamente em andamento (relay caiu no meio de um turno). Deixar
  // aberto é inofensivo: `turnInFlight` no cliente é só local, não é
  // afetado por replay.
  return messages;
}
