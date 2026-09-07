#!/usr/bin/env node
// The relay's one sanctioned mock boundary (see .ultron/skills/tests/SKILL.md
// — "The one sanctioned mock boundary: the `claude` process"). Stands in for
// the real `claude` binary in integration tests via the `CLAUDE_BIN` env var
// (relay/src/claudeCliConfig.ts already reads it, no source change needed).
//
// Understands the two invocation shapes the relay actually spawns:
//   - `-p <text> --output-format stream-json ...`  -> a real turn
//     (claudeSession.ts sendTurn)
//   - `-p /model --output-format json ...`          -> the default-model
//     probe (defaultModel.ts detectDefaultModel)
// Everything else (`auth status --json`) gets a canned success reply so
// routes that shell out to it don't error during a test that isn't
// exercising that path.
//
// Behavior is controlled by env vars so each test can shape the reply
// without touching this file:
//   FAKE_CLAUDE_REPLY  - assistant text to emit (default: "ok")
//   FAKE_CLAUDE_ERROR  - if set, the turn's `result` event comes back with
//                        `is_error: true` and this as the message

import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function flagValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

if (args[0] === "auth" && args[1] === "status") {
  emit({ loggedIn: true, email: "fake@ultron.test", subscriptionType: "pro" });
  process.exit(0);
}

if (args[0] === "-p") {
  const outputFormat = flagValue("--output-format");
  const resumeId = flagValue("--resume");
  const sessionId = resumeId ?? randomUUID();

  if (outputFormat === "json") {
    // The default-model probe (defaultModel.ts) — a single JSON line whose
    // `result` field is CLI usage text, not conversation output.
    emit({
      result:
        "Current model: `Sonnet 5 (default)`\n" +
        "Usage: /model <name>. Available: sonnet, opus, haiku, fable, best, sonnet[1m], opus[1m], fable[1m], opusplan, default, or a full model ID.",
    });
    process.exit(0);
  }

  const replyText = process.env.FAKE_CLAUDE_REPLY ?? "ok";
  const errorMessage = process.env.FAKE_CLAUDE_ERROR;
  const model = "claude-fake-5";

  emit({ type: "system", subtype: "init", session_id: sessionId, model });
  emit({
    type: "assistant",
    session_id: sessionId,
    message: {
      content: [{ type: "text", text: replyText }],
      usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  });
  emit({
    type: "result",
    session_id: sessionId,
    is_error: Boolean(errorMessage),
    result: errorMessage ?? replyText,
    errors: errorMessage ? [errorMessage] : undefined,
    modelUsage: { [model]: { contextWindow: 200000 } },
  });
  process.exit(0);
}

emit({ type: "result", is_error: true, result: `fake-claude: unrecognized invocation: ${args.join(" ")}` });
process.exit(1);
