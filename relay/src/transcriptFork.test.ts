import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { transcriptPath } from "./transcriptReader.js";
import { forkTruncatedTranscript } from "./transcriptFork.js";

function withFixture(sessionId: string, rawLines: unknown[], run: (home: string, path: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), "ultron-transcript-fork-test-"));
  try {
    const path = transcriptPath(home, home, sessionId);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, rawLines.map((line) => JSON.stringify(line)).join("\n") + "\n");
    run(home, path);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function readLines(path: string): Array<Record<string, unknown>> {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("mantém só as linhas antes do turno cortado, com sessionId novo em cada uma", () => {
  withFixture(
    "s1",
    [
      { type: "user", sessionId: "s1", uuid: "u1", message: { content: "pergunta 1" } },
      { type: "assistant", sessionId: "s1", uuid: "a1", message: { content: [{ type: "text", text: "resposta 1" }] } },
      { type: "user", sessionId: "s1", uuid: "u2", message: { content: "pergunta 2 (editada)" } },
      { type: "assistant", sessionId: "s1", uuid: "a2", message: { content: [{ type: "text", text: "resposta 2" }] } },
    ],
    (_home, path) => {
      const newSessionId = forkTruncatedTranscript(path, 1);
      const newPath = join(dirname(path), `${newSessionId}.jsonl`);
      assert.ok(existsSync(newPath));

      const kept = readLines(newPath);
      assert.equal(kept.length, 2);
      assert.equal(kept[0].uuid, "u1");
      assert.equal(kept[1].uuid, "a1");
      assert.ok(kept.every((line) => line.sessionId === newSessionId));
      assert.notEqual(newSessionId, "s1");

      // Arquivo original intacto — o corte nunca mexe nele.
      assert.equal(readLines(path).length, 4);
    },
  );
});

test("turnsToKeep 0: arquivo novo fica vazio (equivalente a /clear, mas o chamador deve preferir resetSessionId nesse caso)", () => {
  withFixture(
    "s1",
    [
      { type: "user", sessionId: "s1", uuid: "u1", message: { content: "primeira mensagem" } },
      { type: "assistant", sessionId: "s1", uuid: "a1", message: { content: [{ type: "text", text: "resposta" }] } },
    ],
    (_home, path) => {
      const newSessionId = forkTruncatedTranscript(path, 0);
      const newPath = join(dirname(path), `${newSessionId}.jsonl`);
      assert.equal(readFileSync(newPath, "utf8"), "");
    },
  );
});

test("linhas que não são texto humano genuíno (tool_result) não contam como turno", () => {
  withFixture(
    "s1",
    [
      { type: "user", sessionId: "s1", uuid: "u1", message: { content: "pergunta 1" } },
      { type: "assistant", sessionId: "s1", uuid: "a1", message: { content: [{ type: "tool_use", id: "t1", name: "Bash" }] } },
      { type: "user", sessionId: "s1", uuid: "u1b", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } },
      { type: "assistant", sessionId: "s1", uuid: "a1b", message: { content: [{ type: "text", text: "feito" }] } },
      { type: "user", sessionId: "s1", uuid: "u2", message: { content: "pergunta 2" } },
    ],
    (_home, path) => {
      // Cortar mantendo 1 turno deve preservar as 4 primeiras linhas (o
      // turno inteiro, incluindo o tool_result no meio), não parar em u1b.
      const newSessionId = forkTruncatedTranscript(path, 1);
      const kept = readLines(join(dirname(path), `${newSessionId}.jsonl`));
      assert.deepEqual(
        kept.map((line) => line.uuid),
        ["u1", "a1", "u1b", "a1b"],
      );
    },
  );
});
