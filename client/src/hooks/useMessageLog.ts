import { useMemo, useReducer } from "react";
import type { ClaudeEvent, ClaudeContentBlock, HistoryMessage, HistoryPageMessage, StructuredPatchHunk } from "@/lib/relay-types";
import type { PendingAttachment } from "@/hooks/useImageUpload";

export type LogEntry =
  | { kind: "user"; id: string; text: string; images?: PendingAttachment[]; sentAt: number }
  | { kind: "text"; id: string; text: string; streaming: boolean; sentAt: number }
  | { kind: "tool-use"; id: string; toolUseId?: string; name: string; input: ClaudeContentBlock["input"] }
  | {
      kind: "tool-result";
      id: string;
      toolUseId?: string;
      content: string;
      isError: boolean;
      structuredPatch?: StructuredPatchHunk[];
    }
  | { kind: "error"; id: string; message: string }
  | { kind: "stopped"; id: string }
  /** Automatic follow-up turn from an `ultron-bg` job that finished
   * (docs/32, Phase D/E) — the synthetic prompt itself never becomes a
   * user bubble (the text is an internal instruction, not something the
   * user typed); this is just the note indicating where the following
   * response came from, same pattern as "stopped" (system note, no bubble). */
  | { kind: "background-job-note"; id: string; label: string };

interface StreamingTextBlock {
  index: number;
  text: string;
}

interface MessageLogState {
  entries: LogEntry[];
  streamingText: StreamingTextBlock[];
  /** Whether there are turns older than `historyCursor` to fetch via
   * `load_older_history` (Phase 2-4, docs/30). `false` until the initial
   * tail arrives (`HYDRATE`) — same default value as before this feature
   * existed (session with no history at all to paginate). */
  hasMoreHistory: boolean;
  /** Position (in the relay's `history`) of the oldest page already loaded
   * — `null` until `HYDRATE`. This is what gets sent back as `beforeCursor`
   * to request the next, older page. */
  historyCursor: number | null;
  /** Older-page request in flight — guards against a duplicate request
   * (Phase 5, UI: scrolling up triggers `beginLoadingOlderHistory` before
   * calling `loadOlderHistory` on the relay). */
  loadingOlderHistory: boolean;
}

type Action =
  | { type: "USER_MESSAGE"; text: string; images?: PendingAttachment[]; sentAt: number }
  /** Message editing (docs/33) — truncates `entries` up to (exclusive) the
   * entry `id` (edited message and everything that came after, on this
   * device's screen) and pushes the new one, optimistically, same as
   * `USER_MESSAGE`. The relay does the real cut (actual transcript +
   * in-memory `history`) asynchronously; this here just gets ahead of the
   * local UI, same spirit as the rest of the reducer. */
  | { type: "EDIT_USER_MESSAGE"; id: string; text: string; sentAt: number }
  | { type: "CLAUDE_EVENT"; event: ClaudeEvent }
  | { type: "TURN_ERROR"; message: string }
  | { type: "TURN_COMPLETE"; stopped?: boolean }
  | { type: "RESET" }
  /** Initial tail received via `history_page` (Phase 2/3, docs/30) — swaps
   * the old replay (one dispatch per event, O(n²) `entries` copying) for a
   * single dispatch that already delivers the final state. */
  | { type: "HYDRATE"; messages: HistoryMessage[]; cursor: number; hasMore: boolean }
  | { type: "REQUEST_OLDER_HISTORY" }
  /** Response to `load_older_history` (Phase 5, docs/30) — turns older
   * than `historyCursor`, inserted at the start of the log. */
  | { type: "PREPEND_HISTORY"; messages: HistoryMessage[]; cursor: number; hasMore: boolean };

const initialState: MessageLogState = {
  entries: [],
  streamingText: [],
  hasMoreHistory: false,
  historyCursor: null,
  loadingOlderHistory: false,
};

function newId(): string {
  return crypto.randomUUID();
}

function commitContentBlock(entries: LogEntry[], block: ClaudeContentBlock, sentAt: number): void {
  if (block.type === "text" && typeof block.text === "string") {
    // Synthetic marker the CLI itself inserts into the transcript when
    // interrupted (`[Request interrupted by user]`, `[...for tool use]`,
    // `[...by a plugin for tool use]`) — not real assistant content.
    // TURN_COMPLETE's `stopped` already covers this notice ("Interrompido
    // pelo usuário."), so committing this too would have duplicated the message on screen.
    if (block.text.startsWith("[Request interrupted")) return;
    entries.push({ kind: "text", id: newId(), text: block.text, streaming: false, sentAt });
  } else if (block.type === "tool_use") {
    entries.push({
      kind: "tool-use",
      id: newId(),
      toolUseId: block.id as string | undefined,
      name: block.name ?? "tool",
      input: block.input,
    });
  } else if (block.type === "tool_result") {
    entries.push({
      kind: "tool-result",
      id: newId(),
      toolUseId: block.tool_use_id,
      content: typeof block.content === "string" ? block.content : JSON.stringify(block.content),
      isError: block.is_error === true,
    });
  }
  // "thinking" (the text almost always comes in empty in real events — see
  // docs/18) and other block types have no visual representation in the
  // log; the turn-in-progress indicator (above the composer) covers that time.
}

/** Applies a single `ClaudeEvent` — extracted from the old
 * `case "CLAUDE_EVENT"` to be reused both by live dispatch (`handleEvent`,
 * one at a time) and by batch hydration (`applyHistoryMessage`, folding a
 * whole page through this same function). `user_prompt` is synthetic: it
 * only exists when rebuilding history from the `.jsonl`
 * (relay/src/transcriptReader.ts) or in the broadcast to a second device
 * connected live (relay/src/sharedSession.ts::runTurn, docs/30 Phase 1) —
 * the protocol never confuses this with anything real. A `user_prompt`
 * marked `synthetic: "background_job"` (relay/src/sharedSession.ts::runTurn,
 * docs/32 Phase D) is a second kind of synthetic, generated by an
 * `ultron-bg` job's automatic follow-up — it becomes a system note, not a
 * user bubble (see comment on `kind: "background-job-note"`). */
function applyClaudeEvent(state: MessageLogState, event: ClaudeEvent): MessageLogState {
  if (event.type === "user_prompt") {
    if (event.synthetic === "background_job") {
      const label = typeof event.label === "string" ? event.label : "job em background";
      return { ...state, entries: [...state.entries, { kind: "background-job-note", id: newId(), label }] };
    }
    const block = event.message?.content?.[0];
    const text = block?.type === "text" ? block.text : undefined;
    if (typeof text !== "string") return state;
    // `event.timestamp` only comes filled in during replay/history or in
    // the broadcast to OTHER devices (docs/33) — whoever sent the message
    // already committed it via `USER_MESSAGE` with the local click time,
    // it never goes through here for its own message. The `Date.now()`
    // fallback would only cover an unexpected event format, shouldn't
    // happen in practice.
    const sentAt = event.timestamp ? Date.parse(event.timestamp) : Date.now();
    return { ...state, entries: [...state.entries, { kind: "user", id: newId(), text, sentAt }] };
  }

  if (event.type === "stream_event" && event.event) {
    const se = event.event;
    if (se.type === "message_start") {
      return { ...state, streamingText: [] };
    }
    if (se.type === "content_block_start" && se.content_block.type === "text") {
      return {
        ...state,
        streamingText: [...state.streamingText.filter((b) => b.index !== se.index), { index: se.index, text: "" }],
      };
    }
    if (se.type === "content_block_delta" && se.delta.type === "text_delta") {
      const index = se.index;
      const chunk = se.delta.text;
      return {
        ...state,
        streamingText: state.streamingText.map((b) => (b.index === index ? { ...b, text: b.text + chunk } : b)),
      };
    }
    return state;
  }

  if (event.type === "assistant" || event.type === "user") {
    const entries = [...state.entries];
    // Unlike `user_prompt`, `event.timestamp` here is a genuine field the
    // CLI itself stamps on every `assistant` stream-json line (verified
    // against real `claude -p --output-format stream-json` output and the
    // on-disk transcript, both live and replayed) — the `Date.now()`
    // fallback only covers an unexpected/older event shape.
    const sentAt = event.timestamp ? Date.parse(event.timestamp) : Date.now();
    for (const block of event.message?.content ?? []) {
      commitContentBlock(entries, block, sentAt);
      // Enriches the most recent tool-result with structuredPatch, if it
      // comes (found in an earlier pass: the relay already delivers Edit's
      // diff ready-made).
      if (block.type === "tool_result" && event.tool_use_result?.structuredPatch) {
        const last = entries[entries.length - 1];
        if (last && last.kind === "tool-result") last.structuredPatch = event.tool_use_result.structuredPatch;
      }
    }
    return { ...state, entries, streamingText: [] };
  }

  return state;
}

/** Applies a `history_page`/`older_history` entry (`HistoryMessage`, same
 * format as `relay/src/sharedSession.ts::BroadcastMessage`) — the same
 * state machine as `applyClaudeEvent`, except it also covers
 * `turn_complete`/`turn_error`, which close a turn (see the original
 * comment on `TURN_COMPLETE` about interrupted partial text). Reused by
 * `HYDRATE` (folds a whole page from scratch) and `PREPEND_HISTORY` (same,
 * result inserted before what already exists). */
function applyHistoryMessage(state: MessageLogState, message: HistoryMessage): MessageLogState {
  if (message.type === "claude_event") return applyClaudeEvent(state, message.event);

  if (message.type === "turn_error") {
    return {
      ...state,
      entries: [...state.entries, { kind: "error", id: newId(), message: message.message }],
      streamingText: [],
    };
  }

  // turn_complete — stopping mid-stream cuts off before the final
  // `assistant` event that normally commits the text into `entries`;
  // without this the partial text (which only existed in `streamingText`,
  // a live preview) would simply vanish from the screen when marking the
  // turn complete.
  const entries = [...state.entries];
  for (const block of state.streamingText) {
    // No `event.timestamp` to fall back on here — this is a stop/interrupt
    // cutting the stream short, not a real `assistant` line.
    if (block.text.length > 0) entries.push({ kind: "text", id: newId(), text: block.text, streaming: false, sentAt: Date.now() });
  }
  if (message.stopped) entries.push({ kind: "stopped", id: newId() });
  return { ...state, entries, streamingText: [] };
}

function reducer(state: MessageLogState, action: Action): MessageLogState {
  switch (action.type) {
    case "USER_MESSAGE":
      return {
        ...state,
        entries: [...state.entries, { kind: "user", id: newId(), text: action.text, images: action.images, sentAt: action.sentAt }],
      };

    case "EDIT_USER_MESSAGE": {
      const index = state.entries.findIndex((entry) => entry.id === action.id);
      // Shouldn't happen (the id comes from an entry rendered right now),
      // but if the log changed under the user for some reason, treat it as
      // a normal send instead of risking truncating in the wrong place —
      // safer than silently cutting everything (`index: -1` would slice
      // the whole array).
      const base = index === -1 ? state.entries : state.entries.slice(0, index);
      return {
        ...state,
        entries: [...base, { kind: "user", id: newId(), text: action.text, sentAt: action.sentAt }],
        streamingText: [],
      };
    }

    case "CLAUDE_EVENT":
      return applyHistoryMessage(state, { type: "claude_event", event: action.event });

    case "TURN_ERROR":
      return applyHistoryMessage(state, { type: "turn_error", message: action.message });

    case "TURN_COMPLETE":
      return applyHistoryMessage(state, { type: "turn_complete", stopped: action.stopped });

    // Reconnection (docs/23, Phase D1) — the relay resends the history
    // tail on every new connection, so the log needs to go back to empty
    // (including the pagination cursor/hasMore) to receive the hydration
    // without duplicating what was already on screen.
    case "RESET":
      return initialState;

    case "HYDRATE": {
      let next: MessageLogState = initialState;
      for (const message of action.messages) next = applyHistoryMessage(next, message);
      return { ...next, hasMoreHistory: action.hasMore, historyCursor: action.cursor, loadingOlderHistory: false };
    }

    case "REQUEST_OLDER_HISTORY":
      return { ...state, loadingOlderHistory: true };

    case "PREPEND_HISTORY": {
      // Calculated from scratch (not from `state`): it's a page strictly
      // older than what's already on screen, processing it on top of the
      // current `state` would mix now's `streamingText` (live turn in
      // progress, if any) with content from the past — the resulting
      // `entries` goes in before what already exists, now's
      // `streamingText` stays untouched.
      let prefix: MessageLogState = initialState;
      for (const message of action.messages) prefix = applyHistoryMessage(prefix, message);
      return {
        ...state,
        entries: [...prefix.entries, ...state.entries],
        hasMoreHistory: action.hasMore,
        historyCursor: action.cursor,
        loadingOlderHistory: false,
      };
    }

    default:
      return state;
  }
}

export interface UseMessageLogResult {
  entries: LogEntry[];
  streamingEntries: LogEntry[];
  /** Whether there are turns older than `historyCursor` to fetch (Phase 5,
   * docs/30) — UI uses this to know whether it still reacts to scrolling
   * to the top. */
  hasMoreHistory: boolean;
  /** `null` until the initial tail arrives (`hydrate`) — after that, it's
   * what gets sent to the relay via `loadOlderHistory(historyCursor)`. */
  historyCursor: number | null;
  /** Older-page request in flight — see `beginLoadingOlderHistory`. */
  loadingOlderHistory: boolean;
  addUserMessage: (text: string, images?: PendingAttachment[]) => void;
  /** Message editing (docs/33) — truncates locally (optimistically) up to
   * message `id` and pushes the new one on top. The relay client is the
   * one that actually sends `edit_message` to the relay; this here only
   * updates this device's screen, same pattern as
   * `addUserMessage`/`sendMessage` in `ChatPanel.onSend`. */
  editUserMessage: (id: string, text: string) => void;
  handleEvent: (event: ClaudeEvent) => void;
  handleTurnError: (message: string) => void;
  handleTurnComplete: (stopped?: boolean) => void;
  reset: () => void;
  /** Hydrates the log with the initial tail received via `history_page`
   * (Phase 2-4, docs/30) — called once per connection, in place of the old
   * event-by-event replay. */
  hydrate: (page: HistoryPageMessage) => void;
  /** Marks that a request for older turns is in flight — call before
   * firing `loadOlderHistory` on the relay (Phase 5, UI), avoids a
   * duplicate request while the response hasn't arrived yet. */
  beginLoadingOlderHistory: () => void;
  /** Inserts a `load_older_history` response at the start of the log
   * (Phase 5, docs/30). */
  prependHistory: (page: HistoryPageMessage) => void;
}

export function useMessageLog(): UseMessageLogResult {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Memoized on `state.streamingText`: without this, every render of the
  // consumer (e.g. ChatPanel's `turnInFlight` changing) would recreate this
  // array with new objects, breaking `React.memo`'s bail-out on log items.
  const streamingEntries: LogEntry[] = useMemo(
    () =>
      state.streamingText
        .filter((b) => b.text.length > 0)
        // `sentAt` here is a placeholder, never shown — the action strip
        // (Message.tsx::AssistantText) stays hidden while `streaming: true`,
        // it only reads `sentAt` once the block has actually committed.
        .map((b) => ({ kind: "text" as const, id: `streaming-${b.index}`, text: b.text, streaming: true, sentAt: Date.now() })),
    [state.streamingText],
  );

  return {
    entries: state.entries,
    streamingEntries,
    hasMoreHistory: state.hasMoreHistory,
    historyCursor: state.historyCursor,
    loadingOlderHistory: state.loadingOlderHistory,
    addUserMessage: (text, images) => dispatch({ type: "USER_MESSAGE", text, images, sentAt: Date.now() }),
    editUserMessage: (id, text) => dispatch({ type: "EDIT_USER_MESSAGE", id, text, sentAt: Date.now() }),
    handleEvent: (event) => dispatch({ type: "CLAUDE_EVENT", event }),
    handleTurnError: (message) => dispatch({ type: "TURN_ERROR", message }),
    handleTurnComplete: (stopped) => dispatch({ type: "TURN_COMPLETE", stopped }),
    reset: () => dispatch({ type: "RESET" }),
    hydrate: (page) => dispatch({ type: "HYDRATE", messages: page.messages, cursor: page.cursor, hasMore: page.hasMore }),
    beginLoadingOlderHistory: () => dispatch({ type: "REQUEST_OLDER_HISTORY" }),
    prependHistory: (page) =>
      dispatch({ type: "PREPEND_HISTORY", messages: page.messages, cursor: page.cursor, hasMore: page.hasMore }),
  };
}
