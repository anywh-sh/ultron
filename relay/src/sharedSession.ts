import type { WebSocket } from "ws";
import { ClaudeSession, type ClaudeEvent } from "./claudeSession.js";
import { checkDirectory } from "./fsBrowse.js";
import { defaultCwd } from "./paths.js";
import { generateSuggestion } from "./suggestionGenerator.js";
import { readHistoryFromTranscript, transcriptPath } from "./transcriptReader.js";
import { forkTruncatedTranscript } from "./transcriptFork.js";
import { INITIAL_HISTORY_TAIL_TURNS, findEditTarget, pageHistoryBefore, type EditTarget } from "./historyPaging.js";
import type { ContextUsage, ModelChoice, PermissionMode } from "./sessionStore.js";
import { toBackgroundJobSummary, type BackgroundJobSummary, type FinishedBackgroundJob, type WatchedJob } from "./backgroundJobs.js";

/** docs/32 Phase D — text of the synthetic turn fired when an `ultron-bg`
 * job finishes. Explicit instruction to only report (not start new work nor
 * another `ultron-bg`) — without this guard, an automatic turn that already
 * has tools unlocked (same `permissionMode` as the session) could turn into
 * a chain of actions the user never asked for.
 *
 * NOTE: kept in Portuguese on purpose — this text is sent as the actual
 * synthetic user message for the turn, so its language is what the model's
 * reply (shown to the user in the chat log) will follow.
 */
function buildBackgroundJobFollowupPrompt(job: FinishedBackgroundJob): string {
  const status = job.exitCode === 0 ? "concluiu com sucesso (exit 0)" : `terminou com erro (exit ${String(job.exitCode)})`;
  const logTail = job.logTail.trim() || "(sem saída)";
  return (
    `[ultron-bg] O processo em background "${job.label}" que você iniciou ${status}. Log (cauda):\n` +
    "```\n" +
    logTail +
    "\n```\n\n" +
    "Resuma o resultado pro usuário, de forma concisa. Isto é só um relatório automático — não inicie " +
    "trabalho novo nem rode outro ultron-bg a partir daqui; se o resultado pedir alguma ação, pergunte " +
    "antes de agir."
  );
}

export type BroadcastMessage =
  | { type: "claude_event"; event: ClaudeEvent }
  | { type: "turn_complete"; stopped?: boolean }
  | { type: "turn_error"; message: string };

// `suggestion` (and other "current" states: cwd_state, permission_mode_state
// etc.) deliberately doesn't enter `BroadcastMessage`/`history` — they're
// sent directly via socket.send instead of `this.broadcast`, and a
// reconnection picks up the current value via `addClient`, not a replay of
// past changes.

export interface SharedSessionOptions {
  /** session_id already persisted for this session (Phase 7 / docs/18), if any. */
  initialSessionId?: string;
  /** Called with the session_id learned after every successful turn — this
   * is how SessionManager writes it to SessionStore. */
  onSessionIdChange?: (sessionId: string) => void;
  /** Called when `/clear` drops local continuity (docs/26) — this is how
   * SessionManager erases the session_id recorded in SessionStore,
   * otherwise a relay restart would go back to `--resume`ing the
   * already-cleared conversation. */
  onSessionIdClear?: () => void;
  /** Session's current cwd (the app's default if the user never picked a folder). */
  initialCwd: string;
  /** If `true`, the folder has already been consumed by a turn and can no
   * longer change — see the comment in `runTurn` for why. */
  initialLocked: boolean;
  /** Called whenever the cwd changes (only possible before the lock) —
   * this is how SessionManager writes it to SessionStore. */
  onCwdChange?: (cwd: string) => void;
  /** Called exactly once, at the moment the session locks (first real turn). */
  onLockChange?: () => void;
  /** Called when a `/clear` unlocks the cwd of a session that was already
   * locked (see `clearConversation`) — counterpart to `onLockChange`. */
  onUnlockChange?: () => void;
  /** Called by `/clear` to drop the persisted title along with the
   * session_id/history — counterpart to `onSessionIdClear`. Without this,
   * `SessionManager`'s `onFirstPrompt` guard (which exists to protect an
   * already-titled session from being overwritten) would also block the new
   * title a cleared conversation needs. */
  onTitleClear?: () => void;
  /** Title already persisted for this session, if any (an old migrated
   * session, or a reload of a new session whose title had already been
   * inferred before the relay restarted). */
  initialTitle?: string | null;
  /** Called exactly once, with the text of the first message that isn't a
   * command (doesn't start with "/") — SessionManager uses this to trigger
   * title generation in parallel with the turn (doesn't block the
   * response). Deliberately decoupled from `onLockChange`: a session whose
   * first messages are `/model opus`/`/clear` locks the cwd normally on the
   * first turn, but only gets a title once a real message arrives
   * (docs/26) — without this the title would come out of the command text. */
  onFirstPrompt?: (text: string) => void;
  /** Called at the start of EVERY turn (not just the first) — this is what
   * lets SessionManager mark `lastActiveAt` in SessionStore, used to sort
   * the sidebar by last interaction. */
  onActivity?: () => void;
  /** Permission mode already persisted for this session (docs/25), or
   * `"bypassPermissions"` for a new session — same hardcoded behavior as
   * before this feature existed. */
  initialPermissionMode: PermissionMode;
  /** Called whenever the mode changes — this is how SessionManager writes
   * it to SessionStore. Unlike `onCwdChange`, it can fire at any point in
   * the conversation (not just before the first turn). */
  onPermissionModeChange?: (mode: PermissionMode) => void;
  /** Context usage already persisted for this session (last turn before a
   * possible relay restart), if any. */
  initialContextUsage?: ContextUsage;
  /** Called at the end of every turn that produced a usable `result` — this
   * is how SessionManager writes it to SessionStore. May not fire for a
   * turn that failed before any API call. */
  onContextUsageChange?: (usage: ContextUsage) => void;
  /** Model already persisted for this session (docs/26), or `undefined` if
   * never chosen via `/model` — in that case `--model` isn't passed on
   * spawn, identical behavior to before this feature existed. */
  initialModel?: ModelChoice;
  /** Called whenever the model changes — same pattern as
   * `onPermissionModeChange`, can fire at any moment. */
  onModelChange?: (model: ModelChoice) => void;
  /** Called with every `ClaudeEvent` of every turn (real or a background
   * follow-up) — this is how `SessionManager` wires up the
   * `BackgroundJobTracker` without `SharedSession` needing to know anything
   * about `ultron-bg` (docs/32, Phase D). Purely observational. */
  onEvent?: (event: ClaudeEvent) => void;
  /** docs/32 Phase F — called with the id of an `ultron-bg` job the user
   * asked to cancel from the UI. Same reasoning as `onEvent`: `SharedSession`
   * doesn't know anything about `BackgroundJobTracker`, it just passes it
   * along for `SessionManager` to decide what to do. */
  onCancelBackgroundJob?: (jobId: string) => void;
  /** Draft text already persisted for this session (composer content not
   * yet sent), if any — prompt-draft feature. */
  initialDraft?: string;
  /** Called whenever the draft changes (debounced on the client side) —
   * this is how SessionManager writes it to SessionStore. */
  onDraftChange?: (draft: string) => void;
  /** Next-message suggestion already persisted for this session, if any —
   * survives a relay restart the same way `initialDraft` does (see
   * `suggestion` below for why this changed from in-memory-only). */
  initialSuggestion?: string | null;
  /** Called whenever the suggestion changes (new one generated, or cleared
   * by a new turn/`/clear`/edit) — this is how SessionManager writes it to
   * SessionStore. */
  onSuggestionChange?: (suggestion: string | null) => void;
}

export type SetCwdResult = { ok: true } | { ok: false; error: string };

/**
 * A Claude session shared by every client connected to it. New clients
 * receive a history replay before switching over to live events — this is
 * what gives the "real-time shared session" across devices (old docs/04,
 * now via docs/11).
 */
export class SharedSession {
  private readonly claude: ClaudeSession;
  private readonly history: BroadcastMessage[] = [];
  private readonly clients = new Set<WebSocket>();
  private turnQueue: Promise<void> = Promise.resolve();
  private cwd: string;
  private locked: boolean;
  private title: string | null;
  private permissionMode: PermissionMode;
  private model: ModelChoice | undefined;
  private draft: string;
  private contextUsage: ContextUsage | undefined;
  /** Next-message suggestion (generated asynchronously at the end of every
   * successful turn, see `runTurn`) — persisted like `draft` (via
   * `onSuggestionChange`/`initialSuggestion`): originally in-memory only,
   * but that meant a relay restart (or rebuild+restart while iterating on
   * the relay itself, a routine occurrence per CLAUDE.md) silently dropped
   * a suggestion that was already showing in the composer's placeholder,
   * with no way to get it back short of a whole new turn. */
  private suggestion: string | null;
  /** Separate from `locked`: a session can lock the cwd on the first turn
   * (e.g. an opening `/model opus`) without yet having a real message for
   * the title — see `onFirstPrompt` above. */
  private firstPromptSeeded = false;
  /** `true` after a `/clear` — prevents `ensureHistoryLoaded` from
   * reloading the old transcript from disk for a client that connects
   * after the clear (its normal guard only looks at `history.length`,
   * which we deliberately zero out on clear). */
  private historyCleared = false;
  /** `null` outside of a turn — timestamp (epoch ms) of when the current
   * turn started, while one is running. "Current" state (like `cwd`),
   * doesn't go into `history`: a client connecting (or reconnecting) picks
   * up the current value via `addClient`, same as `sendCwdState`. */
  private turnStartedAt: number | null = null;
  /** `ultron-bg` jobs currently watched in this session — docs/32 Phase E.
   * Same as `contextUsage`/`suggestion`: in-memory only (doesn't persist
   * across a relay restart), it's `BackgroundJobTracker` itself that
   * survives (or not) between restarts — this list is just a mirror of
   * what it knows RIGHT NOW. */
  private backgroundJobs: BackgroundJobSummary[] = [];

  constructor(
    private readonly homeOverride: string | undefined,
    private readonly options: SharedSessionOptions,
  ) {
    this.claude = new ClaudeSession({ homeOverride, initialSessionId: options.initialSessionId });
    this.cwd = options.initialCwd;
    this.locked = options.initialLocked;
    this.title = options.initialTitle ?? null;
    this.permissionMode = options.initialPermissionMode;
    this.model = options.initialModel;
    this.contextUsage = options.initialContextUsage;
    this.draft = options.initialDraft ?? "";
    this.suggestion = options.initialSuggestion ?? null;
  }

  getCwdState(): { cwd: string; locked: boolean } {
    return { cwd: this.cwd, locked: this.locked };
  }

  getPermissionMode(): PermissionMode {
    return this.permissionMode;
  }

  getModel(): ModelChoice | undefined {
    return this.model;
  }

  getContextUsage(): ContextUsage | undefined {
    return this.contextUsage;
  }

  /** Unlike `setCwd`, has no lock or validation — any of the 4 values is
   * always acceptable at any point in the conversation (docs/25). */
  setPermissionMode(mode: PermissionMode): void {
    this.permissionMode = mode;
    this.options.onPermissionModeChange?.(mode);
    this.broadcastPermissionMode();
  }

  /** Same pattern as `setPermissionMode` — takes effect from the next turn
   * on, no lock or value validation (the WS handler already validates
   * against `MODEL_CHOICES` before it gets here, docs/26). */
  setModel(model: ModelChoice): void {
    this.model = model;
    this.options.onModelChange?.(model);
    this.broadcastModelState();
  }

  getDraft(): string {
    return this.draft;
  }

  setDraft(text: string): void {
    this.draft = text;
    this.options.onDraftChange?.(text);
    this.broadcastDraftState();
  }

  getTitle(): string | null {
    return this.title;
  }

  /** Called both by the title inferred from the first prompt and by a
   * manual rename (SessionManager.renameTitle) — both cases only need to
   * update local state and notify whoever is connected right now (e.g.
   * another device with this session open). Disk persistence is
   * SessionStore's responsibility, not this class's. */
  setTitle(title: string): void {
    this.title = title;
    this.broadcastTitle();
  }

  /** Only allowed before the first turn (see `runTurn`) — the caller
   * (server.ts) already handles the `ok: false` case by sending an error
   * only to the client that asked, not a broadcast. */
  setCwd(path: string): SetCwdResult {
    if (this.locked) return { ok: false, error: "working directory já travado, sessão já tem histórico" };
    const check = checkDirectory(path);
    if (!check.ok) return { ok: false, error: check.error };
    this.cwd = check.path;
    this.options.onCwdChange?.(this.cwd);
    this.broadcastCwdState();
    return { ok: true };
  }

  /** docs/32 Phase E — called by `SessionManager` (via
   * `BackgroundJobTracker.onChanged`) whenever this session's list of
   * watched `ultron-bg` jobs changes. Same pattern as
   * `setTitle`/`setPermissionMode`: updates local state and notifies
   * whoever is connected right now. */
  setBackgroundJobs(jobs: WatchedJob[]): void {
    this.backgroundJobs = jobs.map(toBackgroundJobSummary);
    this.broadcastBackgroundJobs();
  }

  /** docs/32 Phase F — cancellation request coming from the UI (the
   * `ChatPanel` chip). Pure passthrough to `SessionManager`;
   * `setBackgroundJobs` (called by it via the tracker's `onChanged`)
   * already takes care of telling clients the job disappeared from the
   * list — nothing extra needed here. */
  cancelBackgroundJob(jobId: string): void {
    this.options.onCancelBackgroundJob?.(jobId);
  }

  addClient(socket: WebSocket): void {
    // First thing of all — a freshly opened tab knows the cwd/lock
    // immediately, without waiting for a turn or the history replay to finish.
    this.sendCwdState(socket);
    this.sendPermissionMode(socket);
    this.sendModelState(socket);
    if (this.title !== null) this.sendTitle(socket, this.title);
    this.sendContextUsage(socket);
    this.sendDraftState(socket);
    this.sendSuggestion(socket);
    this.sendTurnState(socket);
    this.sendBackgroundJobs(socket);

    this.ensureHistoryLoaded();
    // Phase 2 (docs/30) — only the recent tail (`INITIAL_HISTORY_TAIL_TURNS`
    // turns), not the whole `history`: long sessions (a real finding, "IVT
    // Fix" — 1670 reconstructed lines) used to stall the connection by
    // sending everything at once. The rest comes on demand via
    // `loadOlderHistory`, triggered by the user scrolling up in the UI. A
    // single message with the whole array (not one `send` per event) — this
    // is what lets the client hydrate the log with a single dispatch instead
    // of one per event (the reducer's O(n²) cost).
    const page = pageHistoryBefore(this.history, this.history.length, INITIAL_HISTORY_TAIL_TURNS);
    socket.send(JSON.stringify({ type: "history_page", messages: page.messages, cursor: page.cursor, hasMore: page.hasMore }));
    // Marks the end of the replay for this client — doesn't enter `history`
    // (it's not a session event, it's per-connection), so it's never resent
    // to the next clients that connect. This is what lets the client tell
    // apart a "turn_complete" from history reconstruction vs a real turn
    // that finished after it connected (relevant for OS notifications).
    socket.send(JSON.stringify({ type: "caught_up" }));
    this.clients.add(socket);
  }

  /** Phase 2 (docs/30) — on-demand fetch of turns older than the tail sent
   * in `addClient`, triggered by the user scrolling up in the UI. Only
   * responds to the socket that asked: it's not a session event (doesn't
   * enter `history` again, it's already there), it's a one-off lookup for
   * one client. */
  loadOlderHistory(socket: WebSocket, beforeCursor: number): void {
    const page = pageHistoryBefore(this.history, beforeCursor, INITIAL_HISTORY_TAIL_TURNS);
    socket.send(JSON.stringify({ type: "older_history", messages: page.messages, cursor: page.cursor, hasMore: page.hasMore }));
  }

  removeClient(socket: WebSocket): void {
    this.clients.delete(socket);
  }

  /** Called when the session is deleted (SessionManager.deleteSession) —
   * notifies whoever is connected right now (this tab, or another device
   * with the same session open) before closing the connection, to tell it
   * apart from a real network error. */
  closeAllClients(): void {
    for (const client of this.clients) {
      client.send(JSON.stringify({ type: "session_deleted" }));
      client.close();
    }
    this.clients.clear();
  }

  /**
   * `history` has always been in-memory only — it disappears on every relay
   * restart, even though Claude Code has the complete transcript on disk
   * (docs/20-backlog, "Message history reconstruction via `.jsonl`"). Runs
   * once per process: once loaded, `history` is never empty again for this
   * session. Without `initialSessionId` there's nothing to read (new session).
   */
  private ensureHistoryLoaded(): void {
    if (this.history.length > 0 || this.historyCleared || !this.options.initialSessionId) return;
    const home = defaultCwd(this.homeOverride); // where the child process's ~/.claude/projects/ lives
    this.history.push(...readHistoryFromTranscript(home, this.cwd, this.options.initialSessionId));
  }

  /** `origin` is the socket that sent this message — used only to know who
   * already has the question bubble locally (the sender's `ChatPanel`
   * already committed it optimistically before calling this) so it doesn't
   * get duplicated by the synthetic `user_prompt` that `runTurn` broadcasts
   * to the OTHER devices connected to the same session (see comment there). */
  submitTurn(origin: WebSocket, text: string): void {
    // A previous turn's suggestion no longer applies once a new one starts —
    // clear it right away (don't wait for the turn to finish) so it doesn't
    // stay hanging around for the whole duration of the turn in progress.
    this.clearSuggestion();
    // Enqueue: only one `claude -p` turn runs at a time in this session.
    this.turnQueue = this.turnQueue.then(() => this.runTurn(origin, text));
  }

  /** docs/32 Phase D — fired by `BackgroundJobTracker` (via
   * `SessionManager`) when a job started with `ultron-bg` finishes AFTER
   * the original turn that launched it has already ended (the reason
   * `ultron-bg` exists: that turn's `claude -p` process has already died,
   * so there's no one left to notify the user on its own). Same queue
   * (`turnQueue`) that serializes `/clear` against real turns — never runs
   * in parallel with a user turn nor corrupts `session_id`/history out of
   * order. No `origin` (no client sent this) — `runTurn` broadcasts the
   * synthetic prompt to everyone connected, not just "to the others". */
  submitBackgroundJobResult(job: FinishedBackgroundJob): void {
    this.clearSuggestion();
    const text = buildBackgroundJobFollowupPrompt(job);
    this.turnQueue = this.turnQueue.then(() => this.runTurn(undefined, text, { label: job.label }));
  }

  /** Interrupts the turn in progress, if any — doesn't touch the queue
   * (queued turns, if they ever exist, continue normally afterward). */
  stopTurn(): void {
    this.claude.stop();
  }

  /**
   * Message edit (docs/33): stop the current turn (if any) + cut the real
   * `.jsonl` at the edited message's point + run a new turn with the edited
   * text — automatic from this single call. Interrupts the turn BEFORE
   * enqueueing (not inside `performEdit`) to avoid waiting for the response
   * in progress to finish on its own; the queue (`turnQueue`, the same one
   * that already serializes normal turns and `/clear`) guarantees
   * `performEdit` only runs after that interrupted turn has genuinely
   * resolved — only at that point has the `claude -p` process actually
   * exited and the `.jsonl` has the complete write on disk
   * (`ClaudeSession.stop`, tested against the real binary: `SIGINT` always
   * exits before `sendTurn` resolves).
   */
  editMessage(origin: WebSocket, fromEnd: number, text: string): void {
    const target = findEditTarget(this.history, fromEnd);
    if (!target) {
      origin.send(JSON.stringify({ type: "edit_message_error", message: "Mensagem não encontrada — o histórico pode ter mudado." }));
      return;
    }
    this.clearSuggestion();
    this.claude.stop();
    this.turnQueue = this.turnQueue.then(() => this.performEdit(origin, target, text));
  }

  /** Reuses the normal `runTurn` for the turn with the edited text — same
   * `user_prompt` broadcast to other devices (excluding `origin`, which
   * already optimistically self-truncated like a normal send), same
   * streaming, same `turn_complete`. Only what comes before (truncating the
   * real transcript + the in-memory `history` + notifying the OTHER
   * devices of the cut) is edit-specific. */
  private async performEdit(origin: WebSocket, target: EditTarget, text: string): Promise<void> {
    try {
      if (target.turnsBefore > 0) {
        const sessionId = this.claude.getSessionId();
        // No known session_id but with turns before the cut: only happens
        // if the very first real turn failed before any `result` (a
        // referenceable `.jsonl` never came to exist — see the comment on
        // `ClaudeSession.sendTurn`). In that case there's no file to
        // truncate; the next turn already goes out without `--resume`
        // anyway, so nothing happens here (correct behavior by omission,
        // not special-cased handling).
        if (sessionId) {
          const home = defaultCwd(this.homeOverride);
          const path = transcriptPath(home, this.cwd, sessionId);
          const newSessionId = forkTruncatedTranscript(path, target.turnsBefore);
          this.claude.setSessionId(newSessionId);
          this.options.onSessionIdChange?.(newSessionId);
        }
      } else {
        // Editing the very first message of the session — nothing left to
        // preserve in a new file, equivalent to a `/clear` followed by the
        // edited text.
        this.claude.resetSessionId();
        this.options.onSessionIdClear?.();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[relay] failed to truncate transcript for edit:", message);
      origin.send(JSON.stringify({ type: "edit_message_error", message: "Não foi possível editar essa mensagem." }));
      return;
    }

    this.history.length = target.cutIndex;
    this.contextUsage = undefined;
    this.broadcastContextUsageReset();

    // Syncs OTHER devices connected to this session to the truncated point
    // — `origin` doesn't receive this because it already optimistically
    // self-truncated before sending `edit_message` (same pattern as the
    // synthetic `user_prompt` in `runTurn`, which also skips `origin`).
    const page = pageHistoryBefore(this.history, this.history.length, INITIAL_HISTORY_TAIL_TURNS);
    const payload = JSON.stringify({ type: "history_truncated", messages: page.messages, cursor: page.cursor, hasMore: page.hasMore });
    for (const client of this.clients) {
      if (client !== origin) client.send(payload);
    }

    await this.runTurn(origin, text);
  }

  /** Resolves when there's no turn in progress (nor queued) in this session
   * — used by the relay's graceful shutdown (server.ts) to know when it's
   * safe to exit without interrupting anything mid-flight. `turnQueue`
   * never rejects (`runTurn` handles its own errors and never rethrows), so
   * it's fine to return it directly without a try/catch here. */
  waitForIdle(): Promise<void> {
    return this.turnQueue;
  }

  /** `/clear` (docs/26) — same queue as real turns (`turnQueue`), so it
   * never runs in parallel with a turn in progress and risks one of the
   * two overwriting the other's `session_id`/`history` out of order.
   * Doesn't touch permissionMode or model — only the conversation's CONTENT
   * resets, same as the CLI's real `/clear` (just without running any
   * process: see `ClaudeSession.resetSessionId`). The cwd IS unlocked,
   * unlike the CLI: with no history or `session_id` left, there's nothing
   * left tying the next turn to the old folder (see the comment about the
   * lock in `runTurn`), so the session can pick another one again, just
   * like a new session. */
  clearConversation(): void {
    this.turnQueue = this.turnQueue.then(() => {
      this.claude.resetSessionId();
      this.history.length = 0;
      this.historyCleared = true;
      this.contextUsage = undefined;
      this.options.onSessionIdClear?.();
      // Same reasoning as the session_id/history reset above: the title
      // described the conversation that no longer exists. Also rearms
      // `onFirstPrompt` (docs/26) so the next real message gets a fresh one
      // instead of it staying stuck on the old conversation's title forever.
      this.title = null;
      this.firstPromptSeeded = false;
      this.options.onTitleClear?.();
      if (this.locked) {
        this.locked = false;
        this.options.onUnlockChange?.();
        this.broadcastCwdState();
      }
      this.broadcastContextUsageReset();
      this.clearSuggestion();
      this.broadcastConversationReset();
    });
  }

  /** `origin` is `undefined` only for the synthetic follow-up turn
   * (`submitBackgroundJobResult`) — no specific client "already has the
   * bubble locally" in that case, so the synthetic prompt goes to
   * everyone, and the cwd/title lock (only makes sense for the FIRST real
   * turn of the session, which by definition already happened before any
   * job existed to finish) is skipped. */
  private async runTurn(
    origin: WebSocket | undefined,
    text: string,
    synthetic?: { label: string },
  ): Promise<void> {
    this.options.onActivity?.();

    // A turn in progress is "current" state (same reasoning as
    // cwd/permission/model), not a `history` event — a real finding from
    // testing multi-device: without this, only whoever sent the message saw
    // the "thinking"/timer indicator (`TurnIndicator`), because the
    // client's `turnInFlight` only turns on optimistically for whoever
    // clicked "Send". `startedAt` (not just a boolean) lets another
    // device's timer — or a third device connecting mid-turn — count from
    // the real start, not from when it found out.
    this.turnStartedAt = Date.now();
    this.broadcastTurnState();

    // Syncs the question to the OTHER devices connected to this same
    // session — a real finding: without this, whoever didn't send the
    // message would see the assistant's response appear live without the
    // question that prompted it (the protocol never carried the user's
    // text, only the events the CLI emits afterward). Same synthetic format
    // that `transcriptReader.ts` already uses for the replay reconstructed
    // from disk — the client's reducer (`useMessageLog.ts`) already knows
    // how to handle `user_prompt`. Doesn't send to `origin`: whoever sent it
    // already committed the bubble locally optimistically (`ChatPanel`),
    // getting it back would duplicate it.
    {
      const event: ClaudeEvent = synthetic
        ? { type: "user_prompt", synthetic: "background_job", label: synthetic.label, message: { content: [{ type: "text", text }] } }
        : { type: "user_prompt", message: { content: [{ type: "text", text }] } };
      if (origin) {
        this.broadcastExcept({ type: "claude_event", event }, origin);
      } else {
        this.broadcast({ type: "claude_event", event });
      }
    }

    if (!synthetic) {
      // Locks the folder at the exact moment of the first real turn — not
      // at the WS connection (which already happens before any message)
      // nor in `submitTurn` (avoids a race between two `submitTurn` calls
      // in sequence before the first one dequeues). The session_id this
      // turn may generate gets tied to the current `this.cwd` so
      // `--resume` works later.
      if (!this.locked) {
        this.locked = true;
        this.options.onLockChange?.();
        this.broadcastCwdState();
      }
      // Commands (`/clear`, `/model` etc, docs/26) don't count as a real
      // first prompt for the title — generation only runs once the first
      // message that doesn't start with "/" arrives, even if it's not the
      // session's first turn. A synthetic turn never counts (it's not
      // "the first message" from anyone, and the session has had a title
      // for a while already if a job had time to run and finish).
      if (!this.firstPromptSeeded && !text.trim().startsWith("/")) {
        this.firstPromptSeeded = true;
        this.options.onFirstPrompt?.(text);
      }
    }

    try {
      const { stopped, contextUsage, lastAssistantText } = await this.claude.sendTurn(
        text,
        this.cwd,
        this.permissionMode,
        this.model,
        (event) => {
          this.broadcast({ type: "claude_event", event });
          // docs/32 Phase D — lets the `ultron-bg` job tracker (owned by
          // `SessionManager`) see every event of every turn, looking for
          // the start marker. Purely observational: never throws nor
          // alters the turn's flow.
          this.options.onEvent?.(event);
        },
      );
      const sessionId = this.claude.getSessionId();
      if (sessionId) this.options.onSessionIdChange?.(sessionId);
      if (contextUsage) {
        this.contextUsage = contextUsage;
        this.options.onContextUsageChange?.(contextUsage);
        this.broadcastContextUsage();
      }
      this.broadcast({ type: "turn_complete", stopped });
      // Only suggests a follow-up for a turn that genuinely finished (not
      // interrupted) — fire-and-forget, doesn't delay `turn_complete`
      // above. Speed isn't a priority here (it's a convenience, not part
      // of the main flow), so no timeout/cancellation is needed. A
      // synthetic turn (`synthetic`) never suggests: the "user text" that
      // would feed the generator is the follow-up's internal instruction,
      // not something that makes sense to offer as a real next message.
      if (!stopped && !synthetic) {
        generateSuggestion(this.homeOverride, this.cwd, text, lastAssistantText)
          .then((suggestion) => {
            this.suggestion = suggestion ?? null;
            this.options.onSuggestionChange?.(this.suggestion);
            this.broadcastSuggestion();
          })
          .catch((error: unknown) => {
            console.error("[relay] failed to generate next-message suggestion:", error);
          });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[relay] turn failed:", message);
      this.broadcast({ type: "turn_error", message });
    } finally {
      this.turnStartedAt = null;
      this.broadcastTurnState();
    }
  }

  /** Always sends, even an empty list — same as `sendCwdState`/`sendTurnState`,
   * there's no "hasn't arrived yet" ambiguity here to justify a guard (a
   * session with no jobs and one that never had one look the same to the
   * client: neither shows the indicator). */
  private sendBackgroundJobs(target: WebSocket): void {
    target.send(JSON.stringify({ type: "background_job_state", jobs: this.backgroundJobs }));
  }

  private broadcastBackgroundJobs(): void {
    for (const client of this.clients) this.sendBackgroundJobs(client);
  }

  private sendTurnState(target: WebSocket): void {
    target.send(JSON.stringify({ type: "turn_state", active: this.turnStartedAt !== null, startedAt: this.turnStartedAt ?? undefined }));
  }

  private broadcastTurnState(): void {
    for (const client of this.clients) this.sendTurnState(client);
  }

  private sendCwdState(target: WebSocket): void {
    target.send(JSON.stringify({ type: "cwd_state", cwd: this.cwd, locked: this.locked }));
  }

  private broadcastCwdState(): void {
    for (const client of this.clients) this.sendCwdState(client);
  }

  private sendPermissionMode(target: WebSocket): void {
    target.send(JSON.stringify({ type: "permission_mode_state", mode: this.permissionMode }));
  }

  private broadcastPermissionMode(): void {
    for (const client of this.clients) this.sendPermissionMode(client);
  }

  /** Unlike `sendContextUsage`, always sends — an undefined `model` is a
   * valid, final state ("never chosen, uses the CLI's default"), not a
   * transient "hasn't arrived yet", so there's no ambiguity in notifying
   * the client right at connection. */
  private sendModelState(target: WebSocket): void {
    target.send(JSON.stringify({ type: "model_state", model: this.model ?? null }));
  }

  private broadcastModelState(): void {
    for (const client of this.clients) this.sendModelState(client);
  }

  private sendDraftState(target: WebSocket): void {
    target.send(JSON.stringify({ type: "draft_state", draft: this.draft }));
  }

  /** Same reasoning as `broadcastCwdState`/`broadcastPermissionMode`: "current"
   * state, not a `history` event — a reconnection picks up the current
   * value via `addClient` (`sendDraftState`), not a replay of changes. */
  private broadcastDraftState(): void {
    for (const client of this.clients) this.sendDraftState(client);
  }

  private sendContextUsage(target: WebSocket): void {
    if (!this.contextUsage) return;
    target.send(JSON.stringify({ type: "context_usage_state", usage: this.contextUsage }));
  }

  /** Same reasoning as `broadcastCwdState`/`broadcastTitle`: "current"
   * state, not a `history` event — a reconnection picks up the current
   * value via `addClient` (`sendContextUsage`), not a replay of changes. */
  private broadcastContextUsage(): void {
    for (const client of this.clients) this.sendContextUsage(client);
  }

  /** Only used when a `/clear` (or equivalent) resets the conversation —
   * unlike `sendContextUsage`, sends even without a value (`null`), because
   * the goal here is to tell whoever is already connected that the
   * previous value no longer applies (`sendContextUsage`'s guard exists to
   * avoid confusing "new session, never had a turn" with "had one and was
   * reset"). */
  private broadcastContextUsageReset(): void {
    for (const client of this.clients) {
      client.send(JSON.stringify({ type: "context_usage_state", usage: null }));
    }
  }

  /** Only for already-connected clients (same reasoning as
   * `broadcastContextUsageReset`) — whoever connects after the clear
   * already sees the empty `history` naturally via `addClient`, no signal
   * needed. */
  private broadcastConversationReset(): void {
    for (const client of this.clients) {
      client.send(JSON.stringify({ type: "conversation_reset" }));
    }
  }

  /** Unlike `sendContextUsage`, always sends (even `null`) — there's no
   * "hasn't arrived yet" ambiguity to tell apart here: a session with no
   * suggestion yet and one whose suggestion was cleared look the same to
   * the client (neither shows any placeholder), so it doesn't need the
   * guard `sendContextUsage` has. */
  private sendSuggestion(target: WebSocket): void {
    target.send(JSON.stringify({ type: "suggestion", text: this.suggestion }));
  }

  private broadcastSuggestion(): void {
    for (const client of this.clients) this.sendSuggestion(client);
  }

  private clearSuggestion(): void {
    if (this.suggestion === null) return;
    this.suggestion = null;
    this.options.onSuggestionChange?.(null);
    this.broadcastSuggestion();
  }


  private sendTitle(target: WebSocket, title: string): void {
    target.send(JSON.stringify({ type: "session_title", title }));
  }

  /** Doesn't enter `history` for the same reason as cwd: it's "current"
   * state, not a conversation event — a client reconnecting picks up the
   * current value via `addClient`, not a replay of past changes. */
  private broadcastTitle(): void {
    if (this.title === null) return;
    for (const client of this.clients) this.sendTitle(client, this.title);
  }

  private broadcast(message: BroadcastMessage): void {
    this.history.push(message);
    const payload = JSON.stringify(message);
    for (const client of this.clients) {
      client.send(payload);
    }
  }

  /** Same as `broadcast` (enters `history`, a third device connecting later
   * sees it in the replay), just skips one socket — used by the synthetic
   * `user_prompt` in `runTurn`, which shouldn't go back to whoever already
   * has the bubble locally. */
  private broadcastExcept(message: BroadcastMessage, exclude: WebSocket): void {
    this.history.push(message);
    const payload = JSON.stringify(message);
    for (const client of this.clients) {
      if (client !== exclude) client.send(payload);
    }
  }
}
