// Relay protocol types, extended from what already existed in
// relayClient.ts (Phase 3) — see docs/17 (markdown streaming) and the Phase
// 4 pre-step that inspected real events from the personal relay.

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

/** A `structuredPatch` line that the relay already receives ready-made from
 * Edit — see docs/18, a finding from the Phase 4 pre-step: we don't need to
 * compute the diff on the client. */
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

// Streaming envelope from the (Anthropic) Messages API, as it arrives inside
// `claude_event.event` when `claude_event.type === "stream_event"`.
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

/** Present on `type: "system", subtype: "compact_boundary"` — fired when
 * Claude Code compacts the conversation (automatically when nearing the
 * window limit, or via manual `/compact`). The relay doesn't treat this
 * event specially: it already passes through the generic `onEvent` like any
 * other (`claudeSession.ts` doesn't filter by type), it just needed a type
 * here so the client can recognize it without needing `as`. */
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
  /** Present only when type === "stream_event". */
  event?: StreamEventEnvelope;
  /** Present on "user" events that are a tool_result — see ToolUseResult. */
  tool_use_result?: ToolUseResult;
  /** Present on `type: "system", subtype: "compact_boundary"`. */
  compactMetadata?: CompactBoundaryMetadata;
  /** Present only on `type: "user_prompt"` — ISO from the real `.jsonl` line
   * (history/replay) or approximate time from the live broadcast to other
   * devices (docs/33). Whoever sent the message already knows their own
   * click time, doesn't depend on this. */
  timestamp?: string;
  [key: string]: unknown;
}

/** Mirrors the relay's `PermissionMode` (relay/src/sessionStore.ts) — no
 * cross-package import here, both sides only agree by convention (see
 * docs/25). */
export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions";

/** Mirrors the relay's `ModelChoice` (relay/src/sessionStore.ts) — same
 * convention as `PermissionMode` above, no cross-package import. */
export type ModelChoice = "default" | "sonnet" | "opus" | "haiku" | "fable";

/** Mirrors the relay's `ContextUsage` (relay/src/sessionStore.ts) —
 * `contextWindowSize` itself comes directly from the CLI
 * (`modelUsage[model].contextWindow` from the `result` event), never a
 * static table on the client. */
export interface ContextUsage {
  model: string;
  contextWindowSize: number;
  usedTokens: number;
}

/** A `history` entry from the relay (relay/src/sharedSession.ts::BroadcastMessage)
 * — the subset of `RelayMessage` that also shows up inside
 * `history_page`/`older_history`, batched instead of one `socket.send` per
 * event (Phase 2/3, docs/30). */
export type HistoryMessage =
  | { type: "claude_event"; event: ClaudeEvent }
  | { type: "turn_complete"; stopped?: boolean }
  | { type: "turn_error"; message: string };

/** History page — shape shared by `history_page` (initial tail) and
 * `older_history` (response to `load_older_history`). `hasMore` indicates
 * whether there are older turns than `cursor` left to fetch. */
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
  /** Recent tail of this session's history (Phase 2, docs/30) — sent once
   * per connection, right before `caught_up`, in place of what used to be
   * one `claude_event`/`turn_complete` per `socket.send`. */
  | ({ type: "history_page" } & HistoryPageMessage)
  /** Response to a `load_older_history` requested by the client itself
   * (scrolling up) — same shape as `history_page`, just outside the initial
   * connection flow, and only for the socket that asked. */
  | ({ type: "older_history" } & HistoryPageMessage)
  | { type: "cwd_state"; cwd: string; locked: boolean }
  | { type: "set_cwd_error"; message: string }
  | { type: "session_title"; title: string }
  | { type: "session_deleted" }
  | { type: "permission_mode_state"; mode: PermissionMode }
  | { type: "model_state"; model: ModelChoice | null }
  | { type: "context_usage_state"; usage: ContextUsage | null }
  /** Turn in progress in the session — "current" state (same reasoning as
   * `cwd_state`/`permission_mode_state`), sent again on every new connection
   * (docs/30). `startedAt` (epoch ms) lets `TurnIndicator`'s timer count from
   * the turn's real start even on a device that wasn't the one that sent the
   * message, or that connected mid-turn — without this only the sender saw
   * the indicator (a real finding from testing multi-device). `undefined`
   * when `active` is `false`. */
  | { type: "turn_state"; active: boolean; startedAt?: number }
  /** `/clear` (docs/26) — per-connection signal (doesn't enter replay),
   * notifies an already-connected client that the conversation was reset;
   * whoever connects afterward naturally sees the empty history already. */
  | { type: "conversation_reset" }
  /** This profile's actual default account model (docs/28), probed once at
   * relay boot — not per session, it's the same value for every connection
   * of this process. Used as a display fallback when the session never ran
   * `/model` (`model_state` still `null`). */
  | { type: "default_model_state"; label: string }
  /** Next-message suggestion, generated asynchronously at the end of every
   * successful turn (relay/src/sharedSession.ts) — shown as the composer's
   * placeholder when the field is empty. `null` both for "no suggestion yet"
   * and for "the previous suggestion is no longer valid" (new turn
   * starting, `/clear`). */
  | { type: "suggestion"; text: string | null }
  /** Short summary (up to ~12 words) of what the last response did or left
   * pending, generated asynchronously at the end of every successful turn
   * (relay/src/sharedSession.ts) — used as the OS notification's body
   * (`lib/notifications.ts`; the title is just the conversation's name).
   * Unlike `suggestion`, it's not "current state": it's an event for a
   * specific turn, not resent on a reconnection. `null` on generator
   * failure/empty result — consumers fall back to the last user message. */
  | { type: "notification_summary"; text: string | null }
  /** `ultron-bg` jobs currently observed in the session — "current" state
   * (same reasoning as `cwd_state`/`turn_state`), sent again on every new
   * connection and whenever the list changes (a job starting, ending or
   * expiring — see relay/src/sessionManager.ts::syncBackgroundJobState,
   * docs/32 Phase E). Empty array (not omitted) when there are none. */
  | { type: "background_job_state"; jobs: BackgroundJobSummary[] }
  /** Message editing (docs/33) — sent only to the OTHER devices connected to
   * the session (whoever edited already self-truncated optimistically, like
   * a normal send); syncs the cut-off point before the new turn starts
   * transmitting. Same shape as `history_page`, handled the same way on the
   * client (reset + hydrate). */
  | ({ type: "history_truncated" } & HistoryPageMessage)
  /** Response to an invalid `edit_message` (message not found — e.g. history
   * changed by another device) or one that failed to truncate the real
   * transcript. Only for the socket that requested it. */
  | { type: "edit_message_error"; message: string };

/** An `ultron-bg` job currently observed in this session — docs/32, Phase E.
 * Mirrors the relay's `BackgroundJobSummary` (relay/src/backgroundJobs.ts):
 * no file path or `sessionId` (the session is already the WS connection's). */
export interface BackgroundJobSummary {
  id: string;
  label: string;
  startedAt: number;
}

/** A session as the relay exposes it on `GET /sessions` — `id` is stable
 * since creation, `title` is what the sidebar shows (inferred from the first
 * prompt or set by manual rename). */
export interface SessionSummary {
  id: string;
  title: string;
}
