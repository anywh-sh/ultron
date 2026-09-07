import { generateTitle } from "./titleGenerator.js";
import { SharedSession } from "./sharedSession.js";
import type { SessionStore } from "./sessionStore.js";
import { BackgroundJobTracker, type FinishedBackgroundJob } from "./backgroundJobs.js";
import type { McpChoiceBridge } from "./mcpBridge.js";
import type { McpPermissionBridge } from "./permissionBridge.js";

// Multiple sessions identified by id within the same profile (= one relay
// process) — equivalent to what tmux windows provided in the old
// architecture (docs/08), now on top of the relay. Names used to be
// in-memory only (lost on every restart) until Phase 7 (docs/18) — now they
// persist via SessionStore; at boot, we materialize a SharedSession for
// every id already persisted (cheap: the constructor does no I/O or spawn).
// `id` is stable since creation and never changes; `title` (shown in the UI)
// starts as `null` — only already-titled sessions go into `listTitled()`,
// which is what the sidebar lists.
export class SessionManager {
  private readonly sessions = new Map<string, SharedSession>();
  /** A single tracker for the whole process (not one per session) — `ultron-bg`
   * jobs from different sessions have no relation to each other, but the
   * poller and the observation ceiling (docs/32, Phase C) make more sense
   * shared than duplicated N times. */
  private readonly backgroundJobs: BackgroundJobTracker;

  constructor(
    private readonly homeOverride: string | undefined,
    private readonly sessionStore: SessionStore,
    /** docs/32 Phase F — file where `BackgroundJobTracker` persists the list
     * of watched jobs, to survive a relay restart. Same optional `undefined`
     * that `BackgroundJobTrackerOptions.persistPath` accepts (used by tests
     * that don't pass this), but in production `server.ts` always passes a
     * real path. */
    backgroundJobsFilePath?: string,
    /** docs/46 — `undefined` in tests that don't exercise `present_choice`,
     * same reasoning as `backgroundJobsFilePath`; in production `server.ts`
     * always passes both. */
    private readonly mcpChoiceBridge?: McpChoiceBridge,
    private readonly mcpBridgeBaseUrl?: string,
    /** docs/46 Fase 4 — same "undefined only in tests" reasoning as
     * `mcpChoiceBridge`/`mcpBridgeBaseUrl`. */
    private readonly mcpPermissionBridge?: McpPermissionBridge,
    private readonly mcpPermissionBridgeBaseUrl?: string,
  ) {
    // `this.sessions` needs to exist BEFORE `BackgroundJobTracker` is
    // constructed: if there are persisted jobs from a session that already
    // finished while the relay was down (Phase F), the tracker's
    // constructor schedules an immediate poll (`setImmediate`, not
    // synchronous — real finding: it was synchronous in an earlier version,
    // and `onFinished`/`onChanged` fired BEFORE `this.backgroundJobs` even
    // finished being assigned here, hanging the boot with `TypeError:
    // Cannot read properties of undefined`) to find this out without
    // waiting for the first normal poll — but even deferred, it runs before
    // any client connects; if `this.sessions` were still empty at that
    // point, `handleBackgroundJobFinished` would think the session
    // "doesn't exist" and discard the follow-up for nothing, even though it
    // genuinely exists.
    for (const id of sessionStore.listIds()) {
      this.sessions.set(id, this.createSession(id));
    }
    this.backgroundJobs = new BackgroundJobTracker({
      onFinished: (job) => this.handleBackgroundJobFinished(job),
      onChanged: (sessionId) => this.syncBackgroundJobState(sessionId),
      persistPath: backgroundJobsFilePath,
    });
    // Jobs reloaded from disk that are STILL running (not captured by the
    // synchronous `onChanged` above, which only fires on finish/expiry) —
    // sync their `background_job_state` now, not only when the tracker
    // detects the next change.
    for (const job of this.backgroundJobs.listWatched()) {
      this.syncBackgroundJobState(job.sessionId);
    }
  }

  /** docs/32 Phase D — called by `BackgroundJobTracker` when a job finishes.
   * `this.sessions.get` (not `getOrCreate`): if the session was deleted
   * while the job was running, there's no one to report to — discard
   * silently instead of resurrecting an entry in `SessionStore`. */
  private handleBackgroundJobFinished(job: FinishedBackgroundJob): void {
    const session = this.sessions.get(job.sessionId);
    if (!session) {
      console.warn(
        `[relay] background job "${job.label}" (${job.id}) finished, but session ${job.sessionId} no longer exists — discarding`,
      );
      return;
    }
    session.submitBackgroundJobResult(job);
  }

  /** docs/32 Phase E — keeps the `background_job_state` that `SharedSession`
   * exposes to the client in sync with the tracker whenever a session's list
   * of watched jobs changes (start, finish, or expiry). A session with no
   * open tab (`this.sessions.get` undefined) simply has no one to send it
   * to — no effect, the tracker remains the source of truth. */
  private syncBackgroundJobState(sessionId: string): void {
    this.sessions.get(sessionId)?.setBackgroundJobs(this.backgroundJobs.listWatchedForSession(sessionId));
  }

  listTitled(): { id: string; title: string }[] {
    return this.sessionStore.listTitled();
  }

  /** Resolves when no session has a turn in progress — used by graceful
   * shutdown (server.ts) before letting the process exit. */
  async waitForAllIdle(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) => session.waitForIdle()));
  }

  /** Interrupts (SIGINT, same path as the "Stop" button) the turn in
   * progress for every session — used only as a graceful shutdown fallback
   * when the normal wait deadline runs out, to end quickly and cleanly
   * instead of letting systemd kill the raw `claude -p` processes. */
  stopAllTurns(): void {
    for (const session of this.sessions.values()) session.stopTurn();
  }

  getOrCreate(id: string): SharedSession {
    let session = this.sessions.get(id);
    if (!session) {
      this.sessionStore.recordId(id);
      session = this.createSession(id);
      this.sessions.set(id, session);
    }
    return session;
  }

  /** Manual rename (sidebar dialog) — works even for a session with no tab
   * currently open (`sessions.get` may return `undefined`; only the
   * SessionStore needs to exist). If the session is open on some device,
   * `SharedSession.setTitle` propagates the change live. */
  renameTitle(id: string, title: string): boolean {
    if (this.sessionStore.getTitle(id) === null && !this.sessions.has(id)) return false;
    this.sessionStore.setTitle(id, title);
    this.sessions.get(id)?.setTitle(title);
    return true;
  }

  /** Only removes the session from ultron's control (SessionStore +
   * in-memory map) — doesn't delete the transcript that Claude Code already
   * maintains on its own in `~/.claude/projects/`. Stops the turn in
   * progress (if any) and notifies whoever is connected before dropping the
   * connection. */
  deleteSession(id: string): boolean {
    const session = this.sessions.get(id);
    if (session) {
      session.stopTurn();
      session.closeAllClients();
      this.sessions.delete(id);
    }
    const existedInStore = this.sessionStore.deleteEntry(id);
    return existedInStore || session !== undefined;
  }

  private createSession(id: string): SharedSession {
    const { cwd, locked } = this.sessionStore.getCwdState(id);
    const session = new SharedSession(this.homeOverride, {
      initialSessionId: this.sessionStore.getSessionId(id),
      onSessionIdChange: (sessionId) => this.sessionStore.recordSessionId(id, sessionId),
      onSessionIdClear: () => this.sessionStore.clearSessionId(id),
      onTitleClear: () => this.sessionStore.clearTitle(id),
      initialCwd: cwd,
      initialLocked: locked,
      onCwdChange: (newCwd) => this.sessionStore.setCwd(id, newCwd),
      onLockChange: () => this.sessionStore.lockCwd(id),
      onUnlockChange: () => this.sessionStore.unlockCwd(id),
      initialPermissionMode: this.sessionStore.getPermissionMode(id),
      onPermissionModeChange: (mode) => this.sessionStore.setPermissionMode(id, mode),
      initialModel: this.sessionStore.getModel(id),
      onModelChange: (model) => this.sessionStore.setModel(id, model),
      initialContextUsage: this.sessionStore.getContextUsage(id),
      onContextUsageChange: (usage) => this.sessionStore.setContextUsage(id, usage),
      initialDraft: this.sessionStore.getDraft(id),
      onDraftChange: (text) => this.sessionStore.setDraft(id, text),
      initialSuggestion: this.sessionStore.getSuggestion(id),
      onSuggestionChange: (text) => this.sessionStore.setSuggestion(id, text),
      mcpChoiceBridge: this.mcpChoiceBridge,
      mcpBridgeBaseUrl: this.mcpBridgeBaseUrl,
      mcpPermissionBridge: this.mcpPermissionBridge,
      mcpPermissionBridgeBaseUrl: this.mcpPermissionBridgeBaseUrl,
      onActivity: () => this.sessionStore.touch(id),
      onEvent: (event) => this.backgroundJobs.observeEvent(id, event),
      onCancelBackgroundJob: (jobId) => {
        this.backgroundJobs.cancel(id, jobId);
      },
      initialTitle: this.sessionStore.getTitle(id),
      onFirstPrompt: (text) => {
        // Guards against overwriting an already-titled session: a session
        // migrated from an old format arrives with `initialTitle` filled in
        // (its name at the time), so it never had a null `title` to begin
        // with. A cleared conversation (docs/26, `SharedSession.onTitleClear`)
        // is the other way this can fire with a title already set — there it
        // doesn't apply, since `clearConversation` already nulled it out.
        if (this.sessionStore.getTitle(id) !== null) return;
        generateTitle(this.homeOverride, session.getCwdState().cwd, text)
          .then((title) => {
            this.sessionStore.setTitle(id, title);
            session.setTitle(title);
          })
          .catch((error: unknown) => {
            console.error("[relay] failed to generate session title:", error);
          });
      },
    });
    return session;
  }
}
