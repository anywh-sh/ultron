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
  [key: string]: unknown;
}

export type RelayMessage =
  | { type: "claude_event"; event: ClaudeEvent }
  | { type: "turn_complete"; stopped?: boolean }
  | { type: "turn_error"; message: string }
  | { type: "caught_up" }
  | { type: "cwd_state"; cwd: string; locked: boolean }
  | { type: "set_cwd_error"; message: string }
  | { type: "session_title"; title: string }
  | { type: "session_deleted" };

/** Uma sessão como o relay expõe em `GET /sessions` — `id` é estável desde a
 * criação, `title` é o que a sidebar mostra (inferido do primeiro prompt ou
 * definido por rename manual). */
export interface SessionSummary {
  id: string;
  title: string;
}
