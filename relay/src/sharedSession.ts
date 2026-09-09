import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import { ClaudeSession, type ClaudeEvent } from "./claudeSession.js";
import { checkDirectory } from "./fsBrowse.js";
import {
  CHOICE_ALLOWED_TOOL,
  CHOICE_MCP_SERVER_NAME,
  CHOICE_TOOL_SEARCH_HINT,
  type ChoiceAnswer,
  type ChoiceQuestion,
  type McpChoiceBridge,
} from "./mcpBridge.js";
import { PERMISSION_MCP_SERVER_NAME, PERMISSION_PROMPT_TOOL, type McpPermissionBridge, type PermissionDecision } from "./permissionBridge.js";
import { defaultCwd } from "./paths.js";
import { formatPlanChoiceAnswerText, parsePlanChoiceMarkers } from "./planChoiceMarker.js";
import { generateSuggestion } from "./suggestionGenerator.js";
import { readHistoryFromTranscript, transcriptPath } from "./transcriptReader.js";
import { forkTruncatedTranscript } from "./transcriptFork.js";
import { INITIAL_HISTORY_TAIL_TURNS, findEditTarget, pageHistoryBefore, type EditTarget } from "./historyPaging.js";
import { isPermissionMode, type ContextUsage, type ModelChoice, type PermissionMode } from "./sessionStore.js";
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

/** docs/46 Fase 5 — human-readable summary of a tool call for the generic
 * approval question in `checkPermission` below. Only the field that best
 * identifies the action is picked per tool; anything unrecognized falls
 * back to a truncated JSON dump so no call is ever unreadable, just less
 * nicely formatted than the common cases. */
function describeToolCall(toolName: string, input: unknown): string {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : undefined;
  const field = (name: string): string | undefined => {
    const value = record?.[name];
    return typeof value === "string" ? value : undefined;
  };
  switch (toolName) {
    case "Bash":
      return field("command") ?? JSON.stringify(input);
    case "Write":
    case "Edit":
    case "NotebookEdit":
      return field("file_path") ?? field("notebook_path") ?? JSON.stringify(input);
    default: {
      const json = JSON.stringify(input);
      return json.length > 200 ? `${json.slice(0, 200)}…` : json;
    }
  }
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
  /** docs/46 — shared by every session in the process (like
   * `SessionManager` itself); `undefined` only in tests that don't exercise
   * this feature, in which case `present_choice` is simply never offered to
   * the model (no `--mcp-config` passed), same as before this feature
   * existed. */
  mcpChoiceBridge?: McpChoiceBridge;
  /** Base URL the relay's own HTTP server is reachable at from ITS OWN
   * `claude` child process — always `127.0.0.1`, never the Tailscale address
   * clients use to reach the relay remotely (the child is always local to
   * the relay's machine, `spawn()` never crosses a network, see
   * `claudeSession.ts`). `undefined` alongside `mcpChoiceBridge` in tests. */
  mcpBridgeBaseUrl?: string;
  /** docs/46 Fase 4 — same lifecycle/sharing as `mcpChoiceBridge`, just for
   * `--permission-prompt-tool` instead of `present_choice`. `undefined` in
   * tests that don't exercise this feature, same reasoning. */
  mcpPermissionBridge?: McpPermissionBridge;
  /** Same "local-only, own HTTP server" reasoning as `mcpBridgeBaseUrl`, on
   * its own path prefix (`/permission/:token`, mounted separately in
   * `server.ts`) so the two bridges' tokens never share a namespace. */
  mcpPermissionBridgeBaseUrl?: string;
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
  /** docs/46 — a choice prompt currently waiting for a human answer, if any.
   * Two unrelated mechanisms feed this, told apart by `kind`: `"mcp"` is a
   * real `present_choice` tool call blocked mid-turn (the CLI process is
   * still alive, waiting on `resolve` to produce its `tool_result`); `"planText"`
   * is the `plan`-mode text-marker fallback (`planChoiceMarker.ts`) — that
   * turn already finished by the time this exists, so there's no live call
   * to resolve, only a future turn to enqueue once the human answers (see
   * `answerChoice`). In-memory only, same reasoning as `backgroundJobs`: on
   * a relay restart there's nothing meaningful left to resume either way
   * (the `"mcp"` case loses its underlying `claude` child too, see
   * `McpChoiceBridge`'s per-turn `unregister`) — a fresh `SharedSession`
   * simply has no pending prompt, which is correct. */
  private pendingChoice:
    | { kind: "mcp"; promptId: string; questions: ChoiceQuestion[]; resolve: (answers: ChoiceAnswer[]) => void }
    | { kind: "planText"; promptId: string; questions: ChoiceQuestion[] }
    | undefined;

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

  /** docs/46 — called by the MCP bridge (`McpChoiceBridge`) when the model
   * calls `present_choice` mid-turn. Only one at a time can be pending: a
   * turn is a single `claude -p` process handling one tool call at a time,
   * so there's no scenario where a second call would arrive before this one
   * resolves. The returned promise only settles from `answerChoice` below —
   * genuinely unbounded wait, by design (docs/46: matches how the real
   * interactive CLI already behaves, and every lifecycle path that could
   * leave this dangling — client disconnect, session delete, relay
   * shutdown — already resolves through the SAME turn-in-progress machinery
   * `stopTurn`/`waitForIdle` use, see the comment on `pendingChoice`). */
  presentChoice(questions: ChoiceQuestion[]): Promise<ChoiceAnswer[]> {
    return new Promise((resolve) => {
      const promptId = randomUUID();
      this.pendingChoice = { kind: "mcp", promptId, questions, resolve };
      this.broadcastChoicePrompt();
    });
  }

  /** docs/46 — plan-mode counterpart to `presentChoice`, called by `runTurn`
   * after it sees a `>>>QUESTION:` marker in a turn that has ALREADY
   * finished (unlike the MCP path, there's no live `claude` process to keep
   * waiting). Just publishes the prompt for the UI — `answerChoice` is what
   * turns the eventual answer into the next real turn. */
  private presentPlanChoice(questions: ChoiceQuestion[]): void {
    const promptId = randomUUID();
    this.pendingChoice = { kind: "planText", promptId, questions };
    this.broadcastChoicePrompt();
  }

  /** docs/46 Fase 5 — called by the permission-prompt-tool bridge
   * (`McpPermissionBridge`) for every tool call the CLI itself decided
   * needs human approval given the turn's current mode (see
   * `runTurn`'s `permissionRegistration` — wired for every mode except
   * `bypassPermissions`). Validated against the real binary before writing
   * this: the CLI, not the relay, already does the risk classification —
   * trivial reads/Bash (e.g. `echo`) never reach here at all in `default`,
   * and `acceptEdits` still routes a dangerous-looking `Bash` (`rm -rf`)
   * here despite auto-allowing harmless file edits. So there's no risk
   * policy left for us to invent: anything that reaches this function
   * already needs a real yes/no, we just have to ask it instead of the old
   * Fase 4 blanket auto-allow.
   *
   * `ExitPlanMode` keeps its own wording (a mode transition reads
   * differently than "approve this action"), everything else gets a
   * generic question built from `describeToolCall` below.
   *
   * Reuses `presentChoice` as-is instead of inventing a parallel pending-
   * approval mechanism: a single yes/no `ChoiceQuestion` renders fine with
   * the existing `ChoiceCard`, and `presentChoice`/`answerChoice` already
   * handle every lifecycle edge case (multi-device "first answer wins",
   * cancellation on any form of turn end, Stop button) that a fresh
   * mechanism would need to reimplement — this is why Fase 5 needed no new
   * turn-state UI despite the scope in docs/46 "Ressalvas": the mechanism
   * was already generic, only Fase 4's policy was narrow. */
  private async checkPermission(toolName: string, input: unknown, _toolUseId: string | undefined): Promise<PermissionDecision> {
    const isExitPlanMode = toolName === "ExitPlanMode";
    const question = isExitPlanMode
      ? "O modelo quer sair do modo Plan e continuar a execução. Aprovar?"
      : `O modelo quer executar \`${toolName}\`: ${describeToolCall(toolName, input)}. Aprovar?`;
    const answers = await this.presentChoice([{ question, options: [{ label: "Aprovar" }, { label: "Recusar" }] }]);
    const approved = answers[0]?.selected.includes("Aprovar") ?? false;
    if (approved) return { behavior: "allow", updatedInput: input };
    return {
      behavior: "deny",
      message: isExitPlanMode ? "O usuário optou por continuar no modo Plan." : "O usuário recusou a execução.",
    };
  }

  /** docs/46 Fase 4 — the CLI reports its own permission-mode transitions
   * (e.g. right after approving `ExitPlanMode` mid-turn) via a
   * `{"type":"system","subtype":"status","permissionMode":...}` event,
   * observed immediately after the triggering `tool_use` and before its
   * `tool_result` (confirmed against the real binary, docs/46). Without
   * this, the dropdown would keep showing the mode the human picked before
   * the turn started even though the CLI already moved on, AND the next
   * spawn's `--resume` would pass the stale mode again and silently undo
   * the transition. Guarded on an actual change so a turn with no mode
   * switch doesn't do redundant work on every status event; not
   * `setPermissionMode` (that one is for the human's own dropdown pick and
   * always notifies) because this needs the exact same side effects driven
   * by a different source of truth. */
  private applyPermissionModeFromCli(mode: string): void {
    if (!isPermissionMode(mode) || mode === this.permissionMode) return;
    this.permissionMode = mode;
    this.options.onPermissionModeChange?.(mode);
    this.broadcastPermissionMode();
  }

  /** Whatever's left pending when a turn ends, for ANY reason (normal
   * completion, error, or `stopTurn`/SIGINT — `runTurn`'s `finally` calls
   * this unconditionally), must be force-resolved for the `"mcp"` kind: the
   * `claude` child that would have received the answer no longer exists by
   * the time this runs (`sendTurn`'s promise only resolves after the
   * child's `close` event), so the actual answer content is moot — but
   * without this, `pendingChoice` would linger forever (a reconnecting
   * device would see a picker for a conversation that will never continue),
   * and the `await` inside `McpChoiceBridge.handleRequest` for that call
   * would never settle (`unregister` only removes it from future lookups,
   * it doesn't reach into an already-in-flight call). A `"planText"` prompt
   * has nothing to resolve (no call is blocked on it) — this only runs for
   * one anyway because `presentPlanChoice` is called AFTER `runTurn`'s own
   * `finally`, on that same turn's tail, never before it. */
  private cancelPendingChoice(): void {
    if (!this.pendingChoice) return;
    const pending = this.pendingChoice;
    this.pendingChoice = undefined;
    this.broadcastChoiceResolved(pending.promptId);
    if (pending.kind === "mcp") pending.resolve([]);
  }

  /** A `"planText"` prompt outlives the turn that created it (unlike
   * `"mcp"`, which is tied to a live `claude` call and already gets cleaned
   * up by `cancelPendingChoice` as soon as that turn ends, one way or
   * another). If the human moves on without answering it — sends a new
   * message directly, edits an earlier one, or clears the conversation —
   * the stale card needs this explicit dismissal, called from those exact
   * three sites, or it would keep showing a question for a plan the
   * conversation has already left behind. A `"mcp"` prompt is never touched
   * here: it's already covered by `stopTurn`/`SIGINT` unblocking it via
   * `cancelPendingChoice`. */
  private discardStalePlanChoice(): void {
    if (this.pendingChoice?.kind !== "planText") return;
    const { promptId } = this.pendingChoice;
    this.pendingChoice = undefined;
    this.broadcastChoiceResolved(promptId);
  }

  /** Called from the WS handler (`server.ts`) when any connected device
   * answers. "First answer wins" (docs/46 multi-device requirement): once
   * resolved, `pendingChoice` is cleared immediately, so a second device
   * racing to answer the same prompt simply gets `false` back (its answer
   * is a no-op) instead of a confusing double-resolution — and every device
   * (including the one that didn't answer) is told the prompt is gone via
   * `choice_resolved`, so a stale picker doesn't linger on a screen the
   * user isn't looking at anymore. For `"mcp"`, the answer resolves the
   * blocked tool call directly; for `"planText"` there's no call left to
   * resolve, so the answer is enqueued as an ordinary new turn instead
   * (`origin: undefined` — no client rendered a bubble for it locally the
   * way `submitTurn` callers do, so everyone connected needs the synthetic
   * `user_prompt` broadcast, not just "the others"). */
  answerChoice(promptId: string, answers: ChoiceAnswer[]): boolean {
    if (!this.pendingChoice || this.pendingChoice.promptId !== promptId) return false;
    const pending = this.pendingChoice;
    this.pendingChoice = undefined;
    this.broadcastChoiceResolved(promptId);
    if (pending.kind === "mcp") {
      pending.resolve(answers);
    } else {
      const text = formatPlanChoiceAnswerText(answers);
      this.turnQueue = this.turnQueue.then(() => this.runTurn(undefined, text));
    }
    return true;
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
    if (this.pendingChoice) this.sendChoicePrompt(socket, this.pendingChoice);

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
    // A `"planText"` prompt the human ignored in favor of typing a normal
    // message directly is now stale — dismiss it rather than leave the card
    // showing a question for a plan the conversation has already moved past.
    this.discardStalePlanChoice();
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
    // `claude.stop()` below only unblocks a live `"mcp"` prompt (it's tied
    // to the turn being interrupted) — a `"planText"` one outlives its turn
    // and needs the same explicit dismissal as `submitTurn`.
    this.discardStalePlanChoice();
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
    this.discardStalePlanChoice();
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

    // docs/46 — registered fresh for every turn (not once per session):
    // the token is the endpoint's only auth, and a turn that ends (however
    // it ends — success, error, or `stopTurn`) must not leave a token alive
    // that a since-exited `claude` child could no longer call anyway. Only
    // built outside `plan` mode: the CLI blocks any non-native tool
    // categorically there regardless of `--allowedTools` (docs/46,
    // Descoberta 5) — passing this would be dead weight on every spawn.
    const choiceRegistration =
      this.options.mcpChoiceBridge && this.permissionMode !== "plan"
        ? this.options.mcpChoiceBridge.registerTurn({ presentChoice: (questions) => this.presentChoice(questions) })
        : undefined;
    // docs/46 Fase 4/5 — only skipped in `bypassPermissions`, the one mode
    // whose entire point is "don't ask". Merged below with
    // `choiceRegistration` into a single `--mcp-config` when both are active
    // (every mode except `bypassPermissions` — `plan` only gets this one,
    // `default`/`acceptEdits` get both): validated against the real binary
    // that `--allowedTools` and `--permission-prompt-tool` coexist fine in
    // the same spawn, so there's no need to pick one over the other here.
    const permissionRegistration =
      this.options.mcpPermissionBridge && this.permissionMode !== "bypassPermissions"
        ? this.options.mcpPermissionBridge.registerTurn({
            checkPermission: (toolName, input, toolUseId) => this.checkPermission(toolName, input, toolUseId),
          })
        : undefined;
    // Both bridges wait on a real human (a picker click, an approve/deny
    // decision) with no bytes sent back until that happens — from the CLI's
    // point of view that's indistinguishable from a hung connection. Real
    // finding (2026-09-09): the CLI's own default idle timeout for `"http"`
    // MCP servers is 5 minutes (undocumented in `--help`, confirmed against
    // the CLI's own docs), well inside how long a human can plausibly take
    // to notice a prompt and answer it — the panel was observed disappearing
    // out from under the human mid-decision. `timeout` here overrides that
    // per server (also acts as a floor under the idle timeout, per the same
    // docs) instead of the blanket `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` env
    // var, which would also loosen the timeout for any unrelated MCP server
    // the user has configured on their own account.
    const HUMAN_RESPONSE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
    const mcpServers: Record<string, { type: "http"; url: string; timeout: number }> = {};
    if (choiceRegistration) {
      mcpServers[CHOICE_MCP_SERVER_NAME] = {
        type: "http",
        url: `${this.options.mcpBridgeBaseUrl}/${choiceRegistration.token}`,
        timeout: HUMAN_RESPONSE_TIMEOUT_MS,
      };
    }
    if (permissionRegistration) {
      mcpServers[PERMISSION_MCP_SERVER_NAME] = {
        type: "http",
        url: `${this.options.mcpPermissionBridgeBaseUrl}/${permissionRegistration.token}`,
        timeout: HUMAN_RESPONSE_TIMEOUT_MS,
      };
    }
    const mcp =
      choiceRegistration || permissionRegistration
        ? {
            configJson: JSON.stringify({ mcpServers }),
            allowedTools: choiceRegistration ? CHOICE_ALLOWED_TOOL : undefined,
            permissionPromptTool: permissionRegistration ? PERMISSION_PROMPT_TOOL : undefined,
            // Force the model onto our `present_choice` instead of the CLI's
            // own native `AskUserQuestion` — see the field's doc comment on
            // `McpSpawnConfig` for why the native one silently fails here.
            disallowedTools: choiceRegistration ? "AskUserQuestion" : undefined,
            extraSystemPrompt: choiceRegistration ? CHOICE_TOOL_SEARCH_HINT : undefined,
          }
        : undefined;

    // Hoisted out of the `try` below so the plan-mode marker check after it
    // can see the turn's outcome — needs to run AFTER `finally`'s
    // `cancelPendingChoice`, not before, or that same cleanup would
    // immediately cancel the `"planText"` prompt this is about to create.
    let turnStopped = false;
    let planChoiceText: string | undefined;
    try {
      const { stopped, contextUsage, lastAssistantText } = await this.claude.sendTurn(
        text,
        this.cwd,
        this.permissionMode,
        this.model,
        (event) => {
          // docs/46 Fase 4 — must run BEFORE the broadcast below: a device
          // reconnecting mid-turn right as this arrives should see the
          // updated mode, not a stale one from before this same event was
          // processed. Checked unconditionally (not just when
          // `permissionRegistration` is active) since this event is a
          // general CLI mechanism, not exclusive to the `ExitPlanMode` path.
          if (event.type === "system" && event.subtype === "status" && typeof event.permissionMode === "string") {
            this.applyPermissionModeFromCli(event.permissionMode);
          }
          this.broadcast({ type: "claude_event", event });
          // docs/32 Phase D — lets the `ultron-bg` job tracker (owned by
          // `SessionManager`) see every event of every turn, looking for
          // the start marker. Purely observational: never throws nor
          // alters the turn's flow.
          this.options.onEvent?.(event);
        },
        mcp,
      );
      turnStopped = stopped;
      planChoiceText = lastAssistantText;
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
      choiceRegistration?.unregister();
      permissionRegistration?.unregister();
      this.cancelPendingChoice();
      this.turnStartedAt = null;
      this.broadcastTurnState();
    }

    // docs/46 — plan mode's `present_choice` fallback: that mode never gets
    // the MCP tool at all (`choiceRegistration` above is skipped for it), so
    // a genuinely closed question only shows up as a text marker in the
    // final response. Checked here, after the turn (and its `finally`
    // cleanup) has fully finished, not inside the `try` — see the comment
    // on `turnStopped`/`planChoiceText`.
    if (!turnStopped && !synthetic && this.permissionMode === "plan" && planChoiceText) {
      const questions = parsePlanChoiceMarkers(planChoiceText);
      if (questions.length > 0) this.presentPlanChoice(questions);
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

  /** docs/46 — same "current state" pattern as `sendCwdState`/`sendTurnState`:
   * a device that reconnects (or connects for the first time) mid-wait needs
   * to see the pending question immediately, not just devices that were
   * already there when it was asked. */
  private sendChoicePrompt(target: WebSocket, prompt: { promptId: string; questions: ChoiceQuestion[] }): void {
    target.send(JSON.stringify({ type: "choice_prompt", promptId: prompt.promptId, questions: prompt.questions }));
  }

  private broadcastChoicePrompt(): void {
    if (!this.pendingChoice) return;
    for (const client of this.clients) this.sendChoicePrompt(client, this.pendingChoice);
  }

  /** Tells every connected device the prompt is gone — including whichever
   * one(s) didn't answer, so a stale picker doesn't linger once another
   * device already resolved it (docs/46 multi-device requirement). */
  private broadcastChoiceResolved(promptId: string): void {
    for (const client of this.clients) client.send(JSON.stringify({ type: "choice_resolved", promptId }));
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
