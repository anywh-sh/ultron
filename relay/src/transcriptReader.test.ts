import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readHistoryFromTranscript, transcriptPath } from "./transcriptReader.js";

function withFixture(sessionId: string, rawLines: string[], run: (homeOverride: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), "ultron-transcript-test-"));
  try {
    const file = transcriptPath(home, sessionId);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, rawLines.join("\n"));
    run(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("sessão sem transcript retorna vazio", () => {
  withFixture("does-not-exist", [], (home) => {
    assert.deepEqual(readHistoryFromTranscript(home, "outra-sessao"), []);
  });
});

test("turno simples texto -> texto, sem turn_complete sintético no fim do arquivo", () => {
  withFixture(
    "s1",
    [
      JSON.stringify({ type: "user", message: { content: "oi" } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "olá!" }] } }),
    ],
    (home) => {
      const result = readHistoryFromTranscript(home, "s1");
      assert.deepEqual(result, [
        { type: "claude_event", event: { type: "user_prompt", message: { content: [{ type: "text", text: "oi" }] } } },
        { type: "claude_event", event: { type: "assistant", message: { content: [{ type: "text", text: "olá!" }] } } },
      ]);
    },
  );
});

test("segundo turno fecha o primeiro com turn_complete sintético, tool_use/tool_result passam direto", () => {
  withFixture(
    "s2",
    [
      JSON.stringify({ type: "user", message: { content: "oi" } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "olá!" }] } }),
      JSON.stringify({ type: "user", message: { content: "faz algo" } }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] },
      }),
      JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "pronto" }] } }),
    ],
    (home) => {
      const result = readHistoryFromTranscript(home, "s2");
      const shape = result.map((m) => (m.type === "claude_event" ? `claude_event:${m.event.type}` : m.type));
      assert.deepEqual(shape, [
        "claude_event:user_prompt",
        "claude_event:assistant",
        "turn_complete",
        "claude_event:user_prompt",
        "claude_event:assistant",
        "claude_event:user",
        "claude_event:assistant",
      ]);
    },
  );
});

test("isMeta, tipos desconhecidos e linha truncada são ignorados sem quebrar o parse", () => {
  withFixture(
    "s3",
    [
      JSON.stringify({ type: "user", isMeta: true, message: { content: "<system-reminder>...</system-reminder>" } }),
      JSON.stringify({ type: "queue-operation", operation: "enqueue", content: "faz algo" }),
      JSON.stringify({ type: "user", message: { content: "faz algo" } }),
      JSON.stringify({ type: "future-record-type", whatever: true }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "feito" }] } }),
      '{"type": "user", "message": {"content": "cortada no meio',
    ],
    (home) => {
      const result = readHistoryFromTranscript(home, "s3");
      assert.deepEqual(result, [
        { type: "claude_event", event: { type: "user_prompt", message: { content: [{ type: "text", text: "faz algo" }] } } },
        { type: "claude_event", event: { type: "assistant", message: { content: [{ type: "text", text: "feito" }] } } },
      ]);
    },
  );
});
