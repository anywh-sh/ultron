// Client for our own relay protocol (no longer the ttyd protocol —
// see docs/11-decisao-pivo-stream-json.md and docs/12-prototipo-relay.md).
import type {
  BackgroundJobSummary,
  ClaudeEvent,
  ContextUsage,
  HistoryPageMessage,
  ModelChoice,
  PermissionMode,
  RelayMessage,
  SessionSummary,
} from "@/lib/relay-types";
import { recordAvailableModels } from "@/lib/modelCatalog";

export type {
  BackgroundJobSummary,
  ClaudeContentBlock,
  ClaudeMessage,
  ClaudeEvent,
  ContextUsage,
  HistoryMessage,
  HistoryPageMessage,
  ModelChoice,
  PermissionMode,
  SessionSummary,
} from "@/lib/relay-types";

function isRelayMessage(value: unknown): value is RelayMessage {
  return typeof value === "object" && value !== null && "type" in value;
}

export async function fetchSessions(host: string, port: number): Promise<SessionSummary[]> {
  const response = await fetch(`http://${host}:${port}/sessions`);
  const body = (await response.json()) as { sessions?: SessionSummary[] };
  return body.sessions ?? [];
}

/** Manual rename (sidebar dialog) — works even for a session with no
 * tab open right now (the relay only needs the id, not a live WS connection). */
export async function renameSession(host: string, port: number, id: string, title: string): Promise<void> {
  const response = await fetch(`http://${host}:${port}/sessions/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, title }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `failed to rename session (${String(response.status)})`);
  }
}

/** Only removes the session from ultron's control (sidebar, tabs) — doesn't delete the
 * transcript that Claude Code already keeps on its own. Works even for a
 * session with no tab open right now. */
export async function deleteSession(host: string, port: number, id: string): Promise<void> {
  const response = await fetch(`http://${host}:${port}/sessions/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `failed to delete session (${String(response.status)})`);
  }
}

/** Actually closes a terminal tab (kills the tmux session, not just
 * detaches) — called when clicking the X on a terminal tab. See
 * terminalSession.ts for why this is a separate HTTP call instead
 * of a message on the terminal's own WS (the WS might already be closed
 * at this point, e.g. closing a tab that isn't the currently active one). */
export async function closeTerminal(host: string, port: number, session: string, term: string): Promise<void> {
  const response = await fetch(`http://${host}:${port}/terminals/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session, term }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `failed to close terminal (${String(response.status)})`);
  }
}

export interface RelayClientCallbacks {
  onEvent: (event: ClaudeEvent) => void;
  onTurnComplete: (stopped: boolean) => void;
  onTurnError: (message: string) => void;
  /** End of this session's history replay — completed turns received
   * after this are truly new, not reconstruction (see sharedSession.ts). */
  onCaughtUp: () => void;
  /** Sent right on connection (before history replay) and again every
   * time the working directory changes or locks — see sharedSession.ts. */
  onCwdState: (cwd: string, locked: boolean) => void;
  onSetCwdError?: (message: string) => void;
  /** Sent right on connection (before the replay) and again every time the mode
   * changes — see sharedSession.ts::setPermissionMode. */
  onPermissionModeState: (mode: PermissionMode) => void;
  /** Sent right on connection and again every time the model changes — see
   * sharedSession.ts::setModel. `null` is a valid final state ("never
   * chosen via /model, uses the CLI default"), not "still loading". */
  onModelState: (model: ModelChoice | null) => void;
  /** This profile's account's actual default model (docs/28) — sent
   * as soon as the relay finishes probing at boot (may arrive before or after
   * the connection opens), doesn't change after that for the life of the process. */
  onDefaultModelState?: (label: string, available: ModelChoice[]) => void;
  /** Sent right on connection (if there's already a completed turn in this
   * session) and again at the end of every turn that produced context usage —
   * see sharedSession.ts::broadcastContextUsage. `null` after a
   * `/clear` (see onConversationReset). */
  onContextUsageState?: (usage: ContextUsage | null) => void;
  /** Turn in progress on the session (not just from whoever sent it) — sent right on
   * connection and again every time a turn starts/ends, from any
   * device (docs/30). See relay-types.ts::RelayMessage["turn_state"]. */
  onTurnState?: (state: { active: boolean; startedAt?: number }) => void;
  /** Suggested next message arriving (live or right on connection) —
   * see relay-types.ts::RelayMessage["suggestion"]. `null` clears any
   * suggestion shown. */
  onSuggestion?: (text: string | null) => void;
  /** `/clear` (docs/26) — this session's conversation was reset (by this
   * device or another); whoever consumes this should clear the local
   * message log, same idea as the `reset()` already used in `onReconnecting`. */
  onConversationReset?: () => void;
  onConnectionChange?: (connected: boolean) => void;
  /** Title inferred from the first prompt (or from a manual rename done on
   * another device) arriving live — see sharedSession.ts::setTitle. */
  onSessionTitle?: (title: string) => void;
  /** Session deleted (by this device or another) — see
   * sharedSession.ts::closeAllClients. The socket closes shortly after. */
  onSessionDeleted?: () => void;
  /** Fired right before reopening the connection (automatic backoff or
   * `forceReconnect`) — never on the first connection. The relay resends the
   * entire history on every new connection (`SharedSession.addClient`), so
   * whoever consumes this should reset the message log here, otherwise the replay
   * duplicates everything on top of what was already on screen (docs/23, Phase D1). */
  onReconnecting?: () => void;
  /** Recent tail of this session's history — sent once per connection,
   * right before `onCaughtUp` (Phase 2/3, docs/30). Optional only during the
   * migration: whoever doesn't yet hydrate the log in bulk (Phase 4) simply
   * ignores it and keeps seeing an empty log until that phase exists. */
  onHistoryPage?: (page: HistoryPageMessage) => void;
  /** Response to `loadOlderHistory` (Phase 2/3, docs/30) — turns older
   * than the initial tail, requested on demand (Phase 5: scroll up). */
  onOlderHistory?: (page: HistoryPageMessage) => void;
  /** `ultron-bg` jobs currently observed in the session — sent right on connection
   * (even an empty array, if there are none) and again whenever the list
   * changes, from any device (docs/32, Phase E). */
  onBackgroundJobState?: (jobs: BackgroundJobSummary[]) => void;
  /** Message edit (docs/33) — arrives only on the OTHER devices
   * connected to the session, syncing the cut point before the
   * edited turn starts streaming. Same handling as `onReconnecting` +
   * `onHistoryPage`: whoever consumes this resets the log and hydrates with this page. */
  onHistoryTruncated?: (page: HistoryPageMessage) => void;
  /** `edit_message` that was invalid or failed to truncate the real transcript —
   * arrives only for whoever requested the edit. */
  onEditMessageError?: (message: string) => void;
}

const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 30_000;

export class RelayClient {
  private socket?: WebSocket;
  /** Folder chosen (e.g. via `WorkingDirectoryButton` on a new conversation)
   * before the socket opens — there's no outgoing queue, only the last choice
   * matters. Sent as soon as the connection opens; see `connect`. */
  private pendingCwd: string | null = null;
  /** Same logic as `pendingCwd` — only the last choice before the socket
   * opens matters. */
  private pendingPermissionMode: PermissionMode | null = null;
  /** `false` only after a deliberate `disconnect()` (tab/session switch) —
   * while `true`, every unexpected `close` schedules a new attempt. */
  private shouldReconnect = true;
  private reconnectTimer: number | undefined;
  private reconnectAttempt = 0;
  /** Counts every `connect()` call, including the first — used only to
   * know whether a reconnection is in progress (`> 1`), so as not to fire
   * `onReconnecting` on the initial connection. */
  private connectCount = 0;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly sessionId: string,
    private readonly callbacks: RelayClientCallbacks,
  ) {}

  connect(): void {
    this.connectCount += 1;
    if (this.connectCount > 1) this.callbacks.onReconnecting?.();

    const socket = new WebSocket(
      `ws://${this.host}:${this.port}/?session=${encodeURIComponent(this.sessionId)}`,
    );
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      this.callbacks.onConnectionChange?.(true);
      if (this.pendingCwd !== null) {
        const path = this.pendingCwd;
        this.pendingCwd = null;
        socket.send(JSON.stringify({ type: "set_cwd", path }));
      }
      if (this.pendingPermissionMode !== null) {
        const mode = this.pendingPermissionMode;
        this.pendingPermissionMode = null;
        socket.send(JSON.stringify({ type: "set_permission_mode", mode }));
      }
    });
    socket.addEventListener("close", () => {
      // Late event from a socket that `forceReconnect`/automatic reconnection
      // already replaced — ignore it, otherwise it signals disconnected over a
      // new connection that may already be open.
      if (this.socket !== socket) return;
      this.callbacks.onConnectionChange?.(false);
      this.scheduleReconnect();
    });
    socket.addEventListener("message", (event) => {
      const parsed: unknown = JSON.parse(event.data as string);
      if (!isRelayMessage(parsed)) return;

      if (parsed.type === "claude_event") {
        this.callbacks.onEvent(parsed.event);
      } else if (parsed.type === "turn_complete") {
        this.callbacks.onTurnComplete(parsed.stopped === true);
      } else if (parsed.type === "turn_error") {
        this.callbacks.onTurnError(parsed.message);
      } else if (parsed.type === "caught_up") {
        this.callbacks.onCaughtUp();
      } else if (parsed.type === "cwd_state") {
        this.callbacks.onCwdState(parsed.cwd, parsed.locked);
      } else if (parsed.type === "set_cwd_error") {
        this.callbacks.onSetCwdError?.(parsed.message);
      } else if (parsed.type === "session_title") {
        this.callbacks.onSessionTitle?.(parsed.title);
      } else if (parsed.type === "session_deleted") {
        this.callbacks.onSessionDeleted?.();
      } else if (parsed.type === "permission_mode_state") {
        this.callbacks.onPermissionModeState(parsed.mode);
      } else if (parsed.type === "model_state") {
        this.callbacks.onModelState(parsed.model);
      } else if (parsed.type === "default_model_state") {
        recordAvailableModels(parsed.available);
        this.callbacks.onDefaultModelState?.(parsed.label, parsed.available);
      } else if (parsed.type === "context_usage_state") {
        this.callbacks.onContextUsageState?.(parsed.usage);
      } else if (parsed.type === "turn_state") {
        this.callbacks.onTurnState?.({ active: parsed.active, startedAt: parsed.startedAt });
      } else if (parsed.type === "conversation_reset") {
        this.callbacks.onConversationReset?.();
      } else if (parsed.type === "suggestion") {
        this.callbacks.onSuggestion?.(parsed.text);
      } else if (parsed.type === "history_page") {
        this.callbacks.onHistoryPage?.(parsed);
      } else if (parsed.type === "older_history") {
        this.callbacks.onOlderHistory?.(parsed);
      } else if (parsed.type === "background_job_state") {
        this.callbacks.onBackgroundJobState?.(parsed.jobs);
      } else if (parsed.type === "history_truncated") {
        this.callbacks.onHistoryTruncated?.(parsed);
      } else if (parsed.type === "edit_message_error") {
        this.callbacks.onEditMessageError?.(parsed.message);
      }
    });
  }

  sendMessage(text: string): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: "user_message", text }));
  }

  stopTurn(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: "stop_turn" }));
  }

  /** Message edit (docs/33) — `fromEnd` counts from the end (`1` = the
   * user's last message). The relay stops the current turn (if any),
   * cuts the real transcript at the right point, and runs a new turn with `text`.
   * No pending queue (same reasoning as `setModel`): it only makes sense to
   * call this after at least one message has already been rendered, which
   * means the socket is already open. */
  editMessage(fromEnd: number, text: string): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: "edit_message", fromEnd, text }));
  }

  setCwd(path: string): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      // A new conversation tab allows choosing the folder before the connection opens
      // (see WorkingDirectoryButton) — stores it and sends it as soon as it opens, instead
      // of simply discarding the user's choice.
      this.pendingCwd = path;
      return;
    }
    this.socket.send(JSON.stringify({ type: "set_cwd", path }));
  }

  setPermissionMode(mode: PermissionMode): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      this.pendingPermissionMode = mode;
      return;
    }
    this.socket.send(JSON.stringify({ type: "set_permission_mode", mode }));
  }

  /** No "pending before connecting" queue (unlike `setCwd`/
   * `setPermissionMode`): only triggered via `/model` typed in the composer,
   * which is already disabled while `!connected` — there's never a way to call
   * this before the socket opens. */
  setModel(model: ModelChoice): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: "set_model", model }));
  }

  /** `/clear` (docs/26) — same reasoning as `setModel` about not needing
   * a pending queue. */
  clearConversation(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: "clear_conversation" }));
  }

  /** Fetches turns older than `beforeCursor` (Phase 2/3, docs/30) —
   * triggered by the user scrolling up in the UI (Phase 5). Same reasoning
   * as `setModel` about not needing a pending queue: it only makes sense to
   * call this after the initial tail has already arrived (`onHistoryPage`), so the
   * socket is always already open at this point. */
  loadOlderHistory(beforeCursor: number): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: "load_older_history", beforeCursor }));
  }

  /** Cancels an `ultron-bg` job from the UI (docs/32, Phase F) — same reasoning
   * as `setModel`/`clearConversation` about not needing a pending
   * queue: the chip that exposes this only appears when a job already exists in the
   * list, which means `background_job_state` has already arrived, which
   * means the socket is already open. */
  cancelBackgroundJob(id: string): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: "cancel_background_job", id }));
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.socket?.close();
  }

  /** Called when returning from background/foreground (docs/23, Phase D1) — doesn't
   * trust the native `close` timing, which may never fire on a
   * "zombie" socket (`readyState` still `OPEN` but the network connection has really
   * already died). Only reconnects if the socket isn't genuinely usable;
   * a healthy connection is left untouched (spike 3 showed that sockets
   * usually survive a short background period with no intervention at all). */
  forceReconnect(): void {
    const state = this.socket?.readyState;
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;
    this.clearReconnectTimer();
    this.connect();
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_DELAY_MS);
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== undefined) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }
}
