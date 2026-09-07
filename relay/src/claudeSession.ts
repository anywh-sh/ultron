import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { CLAUDE_BIN, EXTRA_PATH_DIRS } from "./claudeCliConfig.js";
import type { ContextUsage, ModelChoice, PermissionMode } from "./sessionStore.js";

// A turn = a `claude -p` process. Continuity across turns comes from
// `--resume <session_id>`, not from keeping a process alive — see
// docs/10-stream-json-validacao.md and docs/11.
//
// ANTHROPIC_API_KEY is always removed from the child process's environment:
// it's the project's golden rule (docs/00) — if that env var leaks, Claude
// Code starts billing via API instead of using the plan.

/** Appended to every turn, regardless of the active project's CLAUDE.md — it's
 * a preference of the ultron CLIENT, not of a specific project. Without
 * this, when writing a draft meant to be pasted elsewhere (Slack, email),
 * the model sometimes manually wraps the text every ~80 columns (habit
 * inherited from terminal/commit text) — inside a ``` block that's literal
 * (`pre` preserves `\n`), so instead of a fluid paragraph that the UI wraps
 * on its own by screen width, you end up with a paragraph with line breaks
 * in the middle of sentences. Text kept lean on purpose (~1/3 of the
 * original) — this goes into EVERY turn even when it has nothing to do with
 * drafting text, so the token cost of a more explicit reinforcement wasn't
 * worth it until it showed up again in practice. If it happens again, it
 * can be reinforced even at the cost of more tokens.
 *
 * Second paragraph: each turn is a new `claude -p` process (comment at the
 * top of the file) — the internal record backing `run_in_background`/
 * `BashOutput` lives only in THAT process's memory and disappears when the
 * turn ends. Without this warning, the model promises "I'll run this in the
 * background and let you know when it's done" using that native mechanism
 * (or raw `&`/`nohup`) and the promise never gets kept — a real finding from
 * the user, root cause documented in docs/32. `ultron-bg` (script in
 * `relay/scripts/`, included in the PATH above) solves this by staying
 * outside the turn's process; `BackgroundJobTracker` (`backgroundJobs.ts`,
 * wired in `sessionManager.ts`) watches for completion and triggers an
 * automatic follow-up turn (`SharedSession.submitBackgroundJobResult`,
 * docs/32 Phase D) — the promise below is now genuinely kept, validated
 * end-to-end against the real binary (`relay/scripts/manual/test-background-job.mjs`).
 */
const APPEND_SYSTEM_PROMPT =
  "When writing prose meant to be pasted elsewhere (Slack, email), write each paragraph as one " +
  "continuous line, not manually wrapped at a fixed width.\n\n" +
  "For any command that will keep running after this turn ends (a build, a long test suite, " +
  "anything whose result matters later) and is worth tracking, launch it with `ultron-bg start " +
  '--label "<short description>" --cmd "<full shell command>"` — check on it within this same ' +
  "turn with `ultron-bg status <id>` if useful. Never use `&`, `nohup`, or the Bash tool's own " +
  "`run_in_background` for this: none of those survive past this turn, so any promise to 'check " +
  "back' or 'let you know' made through them is always broken. Once launched with `ultron-bg`, " +
  "you don't need to wait for it or keep polling before ending your turn — when it finishes, you " +
  "will automatically get a new turn reporting the result, which the user is notified about. You " +
  "can tell them that.";

/** Env for every relay child process (the `claude -p` turn here, interactive
 * shell in terminalSession.ts) — extracted to one place because the golden
 * rule (never let `ANTHROPIC_API_KEY` leak to the child process, docs/00)
 * must hold equally for both: a terminal opened by the user is just as
 * capable of running `claude` manually as the turn's own spawn. */
export function buildChildEnv(homeOverride: string | undefined): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  if (homeOverride) {
    env.HOME = homeOverride;
  }
  env.PATH = [...EXTRA_PATH_DIRS, env.PATH ?? ""].join(":");
  return env;
}

export interface ClaudeEvent {
  type: string;
  session_id?: string;
  is_error?: boolean;
  result?: string;
  errors?: string[];
  /** Present only in `type: "user_prompt"` (synthetic, never comes from the
   * CLI's stdout) — ISO from the actual `.jsonl` line when rebuilding
   * history, or `new Date().toISOString()` in the live broadcast to other
   * devices (docs/33). Whoever sent the message already knows the click's
   * own time, doesn't depend on this. */
  timestamp?: string;
  [key: string]: unknown;
}

export interface ClaudeSessionOptions {
  /** Overrides the child process's $HOME — used for per-profile isolation (docs/08). */
  homeOverride?: string;
  /** Seeds the session_id from what Phase 7 persisted to disk — see
   * SessionStore/docs/18. Without this, a relay restart would lose
   * `--resume` continuity even with the Claude Code session intact. */
  initialSessionId?: string;
}

/** Pre-built by the caller (`SharedSession`, which owns the "skip in plan
 * mode" decision from docs/46 and the actual MCP server registry) — kept as
 * opaque already-formed CLI arg values here, same as every other spawn
 * parameter, so this file stays a plain spawn wrapper that doesn't need to
 * know anything about MCP or choice prompts. */
export interface McpSpawnConfig {
  /** Full `--mcp-config` JSON payload, ready to pass through. */
  configJson: string;
  /** Full `--allowedTools` value (comma-separated is accepted by the CLI). */
  allowedTools: string;
}

export interface SendTurnResult {
  /** `true` when the turn ended because `stop()` was called, not because
   * `claude` actually finished or errored. */
  stopped: boolean;
  /** `undefined` if the turn didn't get to produce a `result` with the
   * expected fields (e.g. error before any API call) — in that case the
   * caller should keep the last known value, not reset it. */
  contextUsage?: ContextUsage;
  /** Text of the last assistant response on the main thread (doesn't include
   * subagents, same filter as `isMainThreadEvent`) — used only to feed the
   * next-message suggestion generator (suggestionGenerator.ts).
   * `undefined` if the turn didn't produce any text block (e.g. only
   * tool_use before being interrupted). */
  lastAssistantText?: string;
}

interface ContentBlock {
  type?: string;
  text?: string;
}

/** `true` when every block in `content` is a `tool_result` — used to tell a
 * genuine tool-result-bearing `user` event apart from synthetic noise that
 * the CLI also emits with `type: "user"` on the same stdout: `isMeta`
 * reminders/caveats, and (notably) a skill's full instructions being loaded
 * into context — the `Skill` tool's own `tool_result` is a short ack
 * ("Launching skill: X"), immediately followed by a SEPARATE `user` event
 * carrying the skill's whole body as a plain `text` block. Exported —
 * `transcriptReader.ts` uses the same criterion when rebuilding history from
 * disk (where this shape is already dropped); `sendTurn` below applies it
 * live so a skill invocation doesn't get displayed as if it were the agent's
 * own message. */
export function isToolResultOnly(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.length > 0 &&
    content.every((block) => typeof block === "object" && block !== null && (block as { type?: unknown }).type === "tool_result")
  );
}

interface ResultUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface ModelUsageEntry {
  contextWindow?: number;
}

function usageTokenTotal(usage: ResultUsage): number {
  return (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
}

/**
 * `true` only for the specific error text the CLI emits when `--resume`
 * itself is broken — the session's `.jsonl` is gone or was never valid
 * (confirmed against the real binary: "No conversation found with session
 * ID: <id>" and "No conversation found to continue"). This is the ONLY case
 * where dropping `sessionId` is correct, so the next turn starts a fresh
 * conversation instead of repeating the same failure forever (the original
 * reason for clearing on error at all — docs/09, an orphaned session_id
 * after a credentials bug).
 *
 * Every other error `sendTurn` can surface — hitting the 5-hour/weekly usage
 * limit, the API being overloaded, a network hiccup — is transient and says
 * nothing about the session being invalid. Treating those the same way was a
 * real bug: the conversation was still perfectly resumable, but the next
 * turn went out without `--resume` anyway, so the user lost all context the
 * moment the limit reset or the API recovered, indistinguishable from a
 * manual `/clear`.
 */
export function isSessionInvalidError(message: string): boolean {
  return /no conversation found/i.test(message);
}

/**
 * `true` only for `assistant` events on the conversation's main thread —
 * subagents (`Task`) also emit `assistant` events on the same stdout, but
 * with `parent_tool_use_id` pointing at the `tool_use` that triggered them
 * (confirmed by running a real turn with a subagent: its event had
 * `cache_read_input_tokens: 0` — isolated context, starting from zero —
 * quite different from the main thread). Without this filter, a subagent's
 * usage (which can read large files on its own) contaminates the main
 * thread's number.
 */
export function isMainThreadEvent(event: ClaudeEvent): boolean {
  return event.parent_tool_use_id === null || event.parent_tool_use_id === undefined;
}

/**
 * Builds context usage from two complementary sources: `usage` comes from
 * the LAST `assistant` event on the main thread seen in the turn (a single
 * Messages API response — same semantics as Claude Code's official
 * statusline `current_usage`), and `contextWindowSize` comes from
 * `modelUsage[model]` in the turn's ending `result` event — real data from
 * the CLI for that account (e.g. extended 1M context), never a static table
 * of ours.
 *
 * Important: the top-level fields of `result.usage` itself (and
 * `result.usage.iterations`) are aggregates that sum EVERYTHING that ran in
 * the turn, including subagents — tested against a real session and against
 * a turn with a subagent, both inflated the total well beyond what the main
 * thread actually had in context (>100% in a session that hadn't even used
 * 40% of the real limit). That's why this code never reads `result.usage`
 * for tokens — only for `modelUsage` (which is a static property of the
 * model, not a counter, and doesn't suffer from this problem).
 */
export function extractContextUsage(
  resultEvent: ClaudeEvent,
  model: string | undefined,
  lastMainThreadUsage: ResultUsage | undefined,
): ContextUsage | undefined {
  if (!lastMainThreadUsage) return undefined;
  const modelUsage = resultEvent.modelUsage as Record<string, ModelUsageEntry> | undefined;
  if (!modelUsage) return undefined;
  const modelKey = (model && model in modelUsage ? model : undefined) ?? Object.keys(modelUsage)[0];
  const entry = modelKey ? modelUsage[modelKey] : undefined;
  if (!modelKey || !entry?.contextWindow) return undefined;
  return {
    model: modelKey,
    contextWindowSize: entry.contextWindow,
    usedTokens: usageTokenTotal(lastMainThreadUsage),
  };
}

export class ClaudeSession {
  private sessionId: string | undefined;
  private currentChild: ChildProcessWithoutNullStreams | undefined;
  private stopRequested = false;

  constructor(private readonly options: ClaudeSessionOptions = {}) {
    this.sessionId = options.initialSessionId;
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }

  /** `/clear` (docs/26) — doesn't run anything on `claude`, just drops the
   * local continuity: the next `sendTurn` won't carry `--resume`, so it
   * genuinely starts a new conversation on the CLI side, without spending a
   * process/turn just to "tell" it about that. */
  resetSessionId(): void {
    this.sessionId = undefined;
  }

  /** Message editing (docs/33) — after `transcriptFork.ts` writes a new
   * truncated `.jsonl`, the next `sendTurn` needs to `--resume` with that
   * new id, not the old one (which still has the edited message and
   * everything that came after it). */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  /**
   * Interrupts the turn in progress, if any — used by the "Stop" button on
   * the client. Tested directly against the binary: `claude -p` catches
   * `SIGINT` and exits with code 0 (doesn't die "raw"), even sending a final
   * `result` with a valid `session_id` even when interrupted mid-stream —
   * `sendTurn` uses `stopRequested` to avoid treating this as a genuine
   * error (which would erase session continuity for nothing).
   */
  stop(): boolean {
    if (!this.currentChild) return false;
    this.stopRequested = true;
    this.currentChild.kill("SIGINT");
    return true;
  }

  async sendTurn(
    text: string,
    cwd: string,
    permissionMode: PermissionMode,
    model: ModelChoice | undefined,
    onEvent: (event: ClaudeEvent) => void,
    mcp?: McpSpawnConfig,
  ): Promise<SendTurnResult> {
    this.stopRequested = false;
    const args = [
      "-p",
      text,
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--append-system-prompt",
      APPEND_SYSTEM_PROMPT,
      ...(model ? ["--model", model] : []),
      // `bypassPermissions` is the historical default mode (the only one
      // that existed before the mode became selectable, see docs/25) — it
      // stays on the dedicated flag because that's the way, tested against
      // the real binary, to avoid a tool touching a new path (e.g. a
      // freshly uploaded image) getting stuck asking for approval that
      // nobody can give in a non-interactive process (real finding while
      // testing image upload, docs/15). The other modes go straight into
      // the generic flag — headless without `--permission-prompt-tool`
      // never hangs waiting for approval: the action is simply denied and
      // Claude keeps working (official docs, see docs/25).
      ...(permissionMode === "bypassPermissions"
        ? ["--dangerously-skip-permissions"]
        : ["--permission-mode", permissionMode]),
      // docs/46 — only present outside `plan` mode: tested against the real
      // binary that plan mode blocks any non-native tool categorically, no
      // `--allowedTools`/MCP annotation known works around it, so passing
      // this there would just be dead weight on every spawn for nothing.
      ...(mcp ? ["--mcp-config", mcp.configJson, "--allowedTools", mcp.allowedTools] : []),
    ];
    // If a previous `--resume` failed (invalid session, history not found,
    // etc.), sessionId was already cleared below — the next call
    // automatically starts a new conversation instead of repeating the same
    // error forever.
    if (this.sessionId) {
      args.push("--resume", this.sessionId);
    }

    const child = spawn(CLAUDE_BIN, args, {
      env: buildChildEnv(this.options.homeOverride),
      cwd,
    });
    this.currentChild = child;

    try {
      const spawnError = new Promise<never>((_, reject) => {
        child.on("error", (error) => reject(error));
      });

      let stderrOutput = "";
      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderrOutput += text;
        console.error("[relay] claude stderr:", text);
      });

      let eventCount = 0;
      let lastErrorResult: string | undefined;
      let lastModel: string | undefined;
      let lastMainThreadUsage: ResultUsage | undefined;
      let contextUsage: ContextUsage | undefined;
      let lastAssistantText: string | undefined;

      const readLines = (async () => {
        const rl = createInterface({ input: child.stdout });
        for await (const line of rl) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as ClaudeEvent;
          eventCount++;
          if (event.type === "user" && !isToolResultOnly((event.message as { content?: unknown } | undefined)?.content)) {
            continue;
          }
          if (event.type === "system" && event.subtype === "init" && typeof event.model === "string") {
            lastModel = event.model;
          }
          if (event.type === "assistant" && isMainThreadEvent(event)) {
            const message = event.message as { usage?: ResultUsage; content?: ContentBlock[] } | undefined;
            if (message?.usage) lastMainThreadUsage = message.usage;
            // Overwritten on every main-thread assistant event — the last
            // one before `result` is the final response the user saw, which
            // is what matters for the suggestion generator (no need to
            // accumulate every intermediate response in the turn).
            const textBlocks = message?.content?.filter((block) => block.type === "text" && block.text);
            if (textBlocks && textBlocks.length > 0) {
              lastAssistantText = textBlocks.map((block) => block.text).join("\n");
            }
          }
          if (event.type === "result") {
            // Captured whenever present, error or not — a turn interrupted
            // by `stop()` still sends a `result` with a valid `session_id`
            // (tested against the real binary), and without this the
            // session's continuity would be lost for nothing on a stop.
            if (typeof event.session_id === "string") this.sessionId = event.session_id;
            if (event.is_error) {
              lastErrorResult =
                event.errors?.join("; ") || event.result || "erro desconhecido retornado pelo claude";
            }
            contextUsage = extractContextUsage(event, lastModel, lastMainThreadUsage) ?? contextUsage;
          }
          onEvent(event);
        }
      })();

      const exitCode = await new Promise<number | null>((resolve) => {
        child.on("close", (code) => resolve(code));
      });

      await Promise.race([spawnError, readLines]);

      if (lastErrorResult) {
        if (this.stopRequested) return { stopped: true, contextUsage, lastAssistantText };
        if (isSessionInvalidError(lastErrorResult)) this.sessionId = undefined;
        throw new Error(lastErrorResult);
      }
      if (eventCount === 0 || exitCode !== 0) {
        if (this.stopRequested) return { stopped: true, contextUsage, lastAssistantText };
        const message = stderrOutput.trim() || `claude saiu com código ${String(exitCode)} sem produzir nenhum evento`;
        if (isSessionInvalidError(message)) this.sessionId = undefined;
        throw new Error(message);
      }
      return { stopped: false, contextUsage, lastAssistantText };
    } finally {
      this.currentChild = undefined;
    }
  }
}
