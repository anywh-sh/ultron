import { spawn } from "node:child_process";

// Same binary/PATH as the real turn (claudeSession.ts) — identical reason:
// systemd doesn't source the user's interactive shell.
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "/home/user/.local/bin/claude";
const EXTRA_PATH_DIRS = ["/home/user/.local/bin", "/home/user/.nvm/versions/node/v20.19.0/bin"];

// Extracts just the model family — "Sonnet 5 (default)" -> "Sonnet", "Opus 5
// (1M context) (default)" -> "Opus". Same vocabulary as MODEL_LABELS on the
// client (docs/26), so the text already arrives ready to display without
// remapping it there.
const MODEL_NAME_RE = /^Current model:\s*(Sonnet|Opus|Haiku|Fable)\b/i;

/**
 * Runs once at relay boot (server.ts) to find out this profile account's
 * actual default model (docs/28) — found by testing manually: `/model`
 * without an argument is intercepted by the CLI itself before any API call
 * (`num_turns: 0` in the result), so it costs nothing and runs in
 * ~100-200ms. Each profile runs its own relay process with its own `$HOME`
 * (docs/08), so each instance only probes its own account.
 *
 * The actual finding that motivated this: the two profiles have DIFFERENT
 * defaults — personal came back "Sonnet 5 (default)", work came back "Opus 5
 * (1M context) (default)". There was no way to assume a fixed value (e.g.
 * always "Opus") without showing a wrong label for at least one of the two.
 */
export async function detectDefaultModel(homeOverride: string | undefined, cwd: string): Promise<string | undefined> {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  if (homeOverride) env.HOME = homeOverride;
  env.PATH = [...EXTRA_PATH_DIRS, env.PATH ?? ""].join(":");

  const child = spawn(
    CLAUDE_BIN,
    [
      "-p",
      "/model",
      "--output-format",
      "json",
      "--no-session-persistence",
      // Same flags as titleGenerator.ts, same reason: without them, a
      // profile with MCP configured (actual finding while testing the work
      // profile) prints a stray log line on stdout AFTER the JSON (something
      // like "Client. listTools() called but server does not advertise
      // tools capability"), breaking the parse below even with exit code 0.
      "--tools",
      "",
      "--dangerously-skip-permissions",
      "--strict-mcp-config",
    ],
    { env, cwd },
  );

  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (exitCode !== 0) return undefined;

  // Extra defense beyond the flags above: the result always comes on a
  // single line (confirmed by testing), so ignore anything that still leaks
  // after it instead of trying to `JSON.parse` the whole stdout.
  let parsed: { result?: unknown };
  try {
    parsed = JSON.parse(stdout.split("\n")[0] ?? "") as { result?: unknown };
  } catch {
    return undefined;
  }

  const match = typeof parsed.result === "string" ? MODEL_NAME_RE.exec(parsed.result) : null;
  if (!match) return undefined;
  const name = match[1].toLowerCase();
  return name.charAt(0).toUpperCase() + name.slice(1);
}
