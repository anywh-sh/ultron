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
  /** Presente só em `type: "user_prompt"` — ISO da linha real do `.jsonl`
   * (histórico/replay) ou hora aproximada do broadcast ao vivo pros outros
   * dispositivos (docs/33). Quem mandou a mensagem já sabe a própria hora do
   * clique, não depende disso. */
  timestamp?: string;
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

/** Uma entrada de `history` do relay (relay/src/sharedSession.ts::BroadcastMessage)
 * — o subconjunto de `RelayMessage` que também aparece dentro de
 * `history_page`/`older_history`, batelado em vez de um `socket.send` por
 * evento (Fase 2/3, docs/30). */
export type HistoryMessage =
  | { type: "claude_event"; event: ClaudeEvent }
  | { type: "turn_complete"; stopped?: boolean }
  | { type: "turn_error"; message: string };

/** Página de histórico — forma compartilhada por `history_page` (cauda
 * inicial) e `older_history` (resposta a `load_older_history`). `hasMore`
 * indica se existem turnos mais antigos que `cursor` pra buscar. */
export interface HistoryPageMessage {
  messages: HistoryMessage[];
  cursor: number;
  hasMore: boolean;
}

export type RelayMessage =
  | { type: "claude_event"; event: ClaudeEvent }
  | { type: "turn_complete"; stopped?: boolean }
  | { type: "turn_error"; message: string }
  | { type: "caught_up" }
  /** Cauda recente do histórico dessa sessão (Fase 2, docs/30) — mandada uma
   * vez por conexão, logo antes de `caught_up`, no lugar do que antes era um
   * `claude_event`/`turn_complete` por `socket.send`. */
  | ({ type: "history_page" } & HistoryPageMessage)
  /** Resposta a um `load_older_history` pedido pelo próprio cliente (scroll
   * pra cima) — mesma forma de `history_page`, só que fora do fluxo de
   * conexão inicial, e só pro socket que pediu. */
  | ({ type: "older_history" } & HistoryPageMessage)
  | { type: "cwd_state"; cwd: string; locked: boolean }
  | { type: "set_cwd_error"; message: string }
  | { type: "session_title"; title: string }
  | { type: "session_deleted" }
  | { type: "permission_mode_state"; mode: PermissionMode }
  | { type: "model_state"; model: ModelChoice | null }
  | { type: "context_usage_state"; usage: ContextUsage | null }
  /** Turno em andamento na sessão — estado "atual" (mesmo raciocínio de
   * `cwd_state`/`permission_mode_state`), mandado de novo a cada conexão
   * nova (docs/30). `startedAt` (epoch ms) deixa o cronômetro do
   * `TurnIndicator` contar a partir do início real do turno mesmo num
   * dispositivo que não foi quem mandou a mensagem, ou que conectou no meio
   * dele — sem isso só quem mandou via o indicador (achado real testando
   * multi-dispositivo). `undefined` quando `active` é `false`. */
  | { type: "turn_state"; active: boolean; startedAt?: number }
  /** `/clear` (docs/26) — sinal por conexão (não entra em replay), avisa um
   * cliente já conectado que a conversa foi resetada; quem conecta depois
   * já vê o histórico vazio naturalmente. */
  | { type: "conversation_reset" }
  /** Modelo padrão de verdade da conta desse perfil (docs/28), sondado uma
   * vez no boot do relay — não é por sessão, é o mesmo valor pra toda
   * conexão desse processo. Usado como fallback de exibição quando a sessão
   * nunca rodou `/model` (`model_state` ainda `null`). */
  | { type: "default_model_state"; label: string }
  /** Sugestão de próxima mensagem, gerada de forma assíncrona ao fim de todo
   * turno bem-sucedido (relay/src/sharedSession.ts) — mostrada como
   * placeholder do composer quando o campo está vazio. `null` tanto no
   * "ainda não tem sugestão" quanto no "sugestão anterior não vale mais"
   * (novo turno começando, `/clear`). */
  | { type: "suggestion"; text: string | null }
  /** Resumo curto (até ~12 palavras) do que a última resposta fez ou deixou
   * pendente, gerado de forma assíncrona ao fim de todo turno bem-sucedido
   * (relay/src/sharedSession.ts) — usado como corpo da notificação do SO
   * (`lib/notifications.ts`; o título é só o nome da conversa). Diferente de
   * `suggestion`, não é "estado atual": é um evento de um turno específico,
   * não reenviado numa reconexão. `null` em falha/vazio do gerador — quem
   * consome cai pro fallback (última mensagem do usuário). */
  | { type: "notification_summary"; text: string | null }
  /** Jobs `ultron-bg` observados agora na sessão — estado "atual" (mesmo
   * raciocínio de `cwd_state`/`turn_state`), mandado de novo a cada conexão
   * nova e sempre que a lista muda (início, fim ou expiração de um job —
   * ver relay/src/sessionManager.ts::syncBackgroundJobState, docs/32 Fase E).
   * Array vazio (não omitido) quando não há nenhum. */
  | { type: "background_job_state"; jobs: BackgroundJobSummary[] }
  /** Edição de mensagem (docs/33) — mandado só pros OUTROS dispositivos
   * conectados na sessão (quem editou já se autotruncou de forma otimista,
   * igual a um envio normal); sincroniza o ponto de corte antes do turno
   * novo começar a transmitir. Mesma forma de `history_page`, tratado do
   * mesmo jeito no client (reset + hydrate). */
  | ({ type: "history_truncated" } & HistoryPageMessage)
  /** Resposta a um `edit_message` inválido (mensagem não encontrada — ex:
   * histórico mudou por outro dispositivo) ou que falhou ao truncar o
   * transcript real. Só pro socket que pediu. */
  | { type: "edit_message_error"; message: string };

/** Um job `ultron-bg` observado agora nessa sessão — docs/32, Fase E.
 * Espelha `BackgroundJobSummary` do relay (relay/src/backgroundJobs.ts):
 * sem caminho de arquivo nem `sessionId` (a sessão já é a da conexão WS). */
export interface BackgroundJobSummary {
  id: string;
  label: string;
  startedAt: number;
}

/** Uma sessão como o relay expõe em `GET /sessions` — `id` é estável desde a
 * criação, `title` é o que a sidebar mostra (inferido do primeiro prompt ou
 * definido por rename manual). */
export interface SessionSummary {
  id: string;
  title: string;
}
