// Tipos do protocolo do relay, estendidos a partir do que já existia em
// relayClient.ts (Fase 3) — ver docs/17 (streaming de markdown) e o pré-passo
// da Fase 4 que inspecionou eventos reais do relay pessoal.

export interface ClaudeContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  signature?: string;
  name?: string;
  input?: {
    command?: string;
    description?: string;
    file_path?: string;
    old_string?: string;
    new_string?: string;
    replace_all?: boolean;
    [key: string]: unknown;
  };
  content?: unknown;
  is_error?: boolean;
  tool_use_id?: string;
  [key: string]: unknown;
}

export interface ClaudeMessage {
  role?: string;
  content?: ClaudeContentBlock[];
}

/** Uma linha do `structuredPatch` que o relay já recebe pronto do Edit —
 * ver docs/18, achado do pré-passo da Fase 4: não precisamos computar diff
 * no cliente. */
export interface StructuredPatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface ToolUseResult {
  filePath?: string;
  oldString?: string;
  newString?: string;
  structuredPatch?: StructuredPatchHunk[];
  [key: string]: unknown;
}

// Envelope de streaming da Messages API (Anthropic), como chega dentro de
// `claude_event.event` quando `claude_event.type === "stream_event"`.
export type StreamDelta =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; thinking: string }
  | { type: "signature_delta"; signature: string }
  | { type: "input_json_delta"; partial_json: string };

export type StreamEventEnvelope =
  | { type: "message_start" }
  | { type: "content_block_start"; index: number; content_block: ClaudeContentBlock }
  | { type: "content_block_delta"; index: number; delta: StreamDelta }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta" }
  | { type: "message_stop" };

/** Presente em `type: "system", subtype: "compact_boundary"` — disparado
 * quando o Claude Code compacta a conversa (automaticamente ao se aproximar
 * do limite da janela, ou via `/compact` manual). O relay não trata esse
 * evento de forma especial: ele já atravessa o `onEvent` genérico igual
 * qualquer outro (`claudeSession.ts` não filtra por tipo), só precisava
 * ganhar um tipo aqui pro cliente reconhecer sem precisar de `as`. */
export interface CompactBoundaryMetadata {
  trigger: "auto" | "manual";
  preTokens: number;
}

export interface ClaudeEvent {
  type: string;
  subtype?: string;
  message?: ClaudeMessage;
  session_id?: string;
  result?: string;
  status?: string;
  /** Presente só quando type === "stream_event". */
  event?: StreamEventEnvelope;
  /** Presente em eventos "user" que são tool_result — ver ToolUseResult. */
  tool_use_result?: ToolUseResult;
  /** Presente em `type: "system", subtype: "compact_boundary"`. */
  compactMetadata?: CompactBoundaryMetadata;
  [key: string]: unknown;
}

/** Espelha `PermissionMode` do relay (relay/src/sessionStore.ts) — sem
 * import cross-package aqui, os dois lados só concordam por convenção (ver
 * docs/25). */
export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions";

/** Espelha `ModelChoice` do relay (relay/src/sessionStore.ts) — mesma
 * convenção do `PermissionMode` acima, sem import cross-package. */
export type ModelChoice = "default" | "sonnet" | "opus" | "haiku" | "fable";

/** Espelha `ContextUsage` do relay (relay/src/sessionStore.ts) — mesmo
 * `contextWindowSize` vindo direto do CLI (`modelUsage[model].contextWindow`
 * do evento `result`), nunca uma tabela estática no cliente. */
export interface ContextUsage {
  model: string;
  contextWindowSize: number;
  usedTokens: number;
}

export type RelayMessage =
  | { type: "claude_event"; event: ClaudeEvent }
  | { type: "turn_complete"; stopped?: boolean }
  | { type: "turn_error"; message: string }
  | { type: "caught_up" }
  | { type: "cwd_state"; cwd: string; locked: boolean }
  | { type: "set_cwd_error"; message: string }
  | { type: "session_title"; title: string }
  | { type: "session_deleted" }
  | { type: "permission_mode_state"; mode: PermissionMode }
  | { type: "model_state"; model: ModelChoice | null }
  | { type: "context_usage_state"; usage: ContextUsage | null }
  /** `/clear` (docs/26) — sinal por conexão (não entra em replay), avisa um
   * cliente já conectado que a conversa foi resetada; quem conecta depois
   * já vê o histórico vazio naturalmente. */
  | { type: "conversation_reset" }
  /** Modelo padrão de verdade da conta desse perfil (docs/28), sondado uma
   * vez no boot do relay — não é por sessão, é o mesmo valor pra toda
   * conexão desse processo. Usado como fallback de exibição quando a sessão
   * nunca rodou `/model` (`model_state` ainda `null`). */
  | { type: "default_model_state"; label: string };

/** Uma sessão como o relay expõe em `GET /sessions` — `id` é estável desde a
 * criação, `title` é o que a sidebar mostra (inferido do primeiro prompt ou
 * definido por rename manual). */
export interface SessionSummary {
  id: string;
  title: string;
}
