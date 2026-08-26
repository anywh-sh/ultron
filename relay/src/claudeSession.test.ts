import { test } from "node:test";
import assert from "node:assert/strict";
import { extractContextUsage, type ClaudeEvent } from "./claudeSession.js";

// Shape real de um evento `result`, capturado rodando `claude -p` de verdade
// (ver plano do indicador de janela de contexto) — usado como base pros
// testes abaixo pra não deixar a asserção descolada do formato real do CLI.
function resultEvent(overrides: Partial<ClaudeEvent> = {}): ClaudeEvent {
  return {
    type: "result",
    session_id: "sess-1",
    usage: {
      input_tokens: 2,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 30691,
      output_tokens: 4,
    },
    modelUsage: {
      "claude-sonnet-5": { contextWindow: 1_000_000, canonicalModel: "claude-sonnet-5" },
    },
    ...overrides,
  };
}

test("extrai model/contextWindowSize/usedTokens do shape real de um result", () => {
  const usage = extractContextUsage(resultEvent(), "claude-sonnet-5");
  assert.deepEqual(usage, {
    model: "claude-sonnet-5",
    contextWindowSize: 1_000_000,
    // input_tokens(2) + cache_creation_input_tokens(0) + cache_read_input_tokens(30691)
    // — output_tokens(4) fica de fora de propósito, mesma fórmula do
    // `used_percentage` oficial do statusline do Claude Code.
    usedTokens: 30693,
  });
});

test("model desconhecido (init não capturado): cai pra primeira entrada de modelUsage em vez de descartar", () => {
  const usage = extractContextUsage(resultEvent(), undefined);
  assert.deepEqual(usage, {
    model: "claude-sonnet-5",
    contextWindowSize: 1_000_000,
    usedTokens: 30693,
  });
});

test("model capturado não bate com nenhuma chave de modelUsage: mesmo fallback, não retorna undefined", () => {
  const usage = extractContextUsage(resultEvent(), "claude-opus-5");
  assert.deepEqual(usage, {
    model: "claude-sonnet-5",
    contextWindowSize: 1_000_000,
    usedTokens: 30693,
  });
});

test("sem campo usage no evento: retorna undefined", () => {
  const event = resultEvent();
  delete event.usage;
  assert.equal(extractContextUsage(event, "claude-sonnet-5"), undefined);
});

test("sem campo modelUsage no evento: retorna undefined", () => {
  const event = resultEvent();
  delete event.modelUsage;
  assert.equal(extractContextUsage(event, "claude-sonnet-5"), undefined);
});

test("modelUsage[model] sem contextWindow: retorna undefined em vez de inventar um limite", () => {
  const usage = extractContextUsage(
    resultEvent({ modelUsage: { "claude-sonnet-5": { canonicalModel: "claude-sonnet-5" } } }),
    "claude-sonnet-5",
  );
  assert.equal(usage, undefined);
});

test("modelUsage vazio ({}): retorna undefined em vez de quebrar no fallback", () => {
  const usage = extractContextUsage(resultEvent({ modelUsage: {} }), "claude-sonnet-5");
  assert.equal(usage, undefined);
});

test("campos de usage ausentes (ex: turno interrompido cedo) contam como 0, não quebram a soma", () => {
  const usage = extractContextUsage(
    resultEvent({ usage: { cache_read_input_tokens: 500 } }),
    "claude-sonnet-5",
  );
  assert.deepEqual(usage, {
    model: "claude-sonnet-5",
    contextWindowSize: 1_000_000,
    usedTokens: 500,
  });
});

test("evento sem relação com result (ex: assistant) ainda extrai se tiver os campos — a checagem de type é de quem chama", () => {
  // `extractContextUsage` não olha `event.type`; `sendTurn` só chama isso
  // dentro do `if (event.type === "result")`. Documenta essa divisão de
  // responsabilidade em vez de deixar implícita.
  const usage = extractContextUsage(resultEvent({ type: "assistant" }), "claude-sonnet-5");
  assert.notEqual(usage, undefined);
});
