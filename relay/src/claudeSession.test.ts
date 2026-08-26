import { test } from "node:test";
import assert from "node:assert/strict";
import { extractContextUsage, isMainThreadEvent, type ClaudeEvent } from "./claudeSession.js";

// Shapes reais, capturados rodando `claude -p` de verdade (ver plano do
// indicador de janela de contexto) — usados como base pros testes abaixo
// pra não deixar a asserção descolada do formato real do CLI.
function resultEvent(overrides: Partial<ClaudeEvent> = {}): ClaudeEvent {
  return {
    type: "result",
    session_id: "sess-1",
    modelUsage: {
      "claude-sonnet-5": { contextWindow: 1_000_000, canonicalModel: "claude-sonnet-5" },
    },
    ...overrides,
  };
}

function assistantUsage(overrides: Record<string, unknown> = {}) {
  return {
    input_tokens: 2,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 30691,
    output_tokens: 4,
    ...overrides,
  };
}

test("extrai model/contextWindowSize/usedTokens combinando o último assistant do fio principal com o result", () => {
  const usage = extractContextUsage(resultEvent(), "claude-sonnet-5", assistantUsage());
  assert.deepEqual(usage, {
    model: "claude-sonnet-5",
    contextWindowSize: 1_000_000,
    // input_tokens(2) + cache_creation_input_tokens(0) + cache_read_input_tokens(30691)
    // — output_tokens(4) fica de fora de propósito, mesma fórmula do
    // `used_percentage` oficial do statusline do Claude Code.
    usedTokens: 30693,
  });
});

test("sem uso do fio principal ainda visto (turno falhou antes de qualquer resposta): retorna undefined", () => {
  assert.equal(extractContextUsage(resultEvent(), "claude-sonnet-5", undefined), undefined);
});

test("model desconhecido (init não capturado): cai pra primeira entrada de modelUsage em vez de descartar", () => {
  const usage = extractContextUsage(resultEvent(), undefined, assistantUsage());
  assert.deepEqual(usage, {
    model: "claude-sonnet-5",
    contextWindowSize: 1_000_000,
    usedTokens: 30693,
  });
});

test("model capturado não bate com nenhuma chave de modelUsage: mesmo fallback, não retorna undefined", () => {
  const usage = extractContextUsage(resultEvent(), "claude-opus-5", assistantUsage());
  assert.deepEqual(usage, {
    model: "claude-sonnet-5",
    contextWindowSize: 1_000_000,
    usedTokens: 30693,
  });
});

test("sem campo modelUsage no evento result: retorna undefined", () => {
  const event = resultEvent();
  delete event.modelUsage;
  assert.equal(extractContextUsage(event, "claude-sonnet-5", assistantUsage()), undefined);
});

test("modelUsage[model] sem contextWindow: retorna undefined em vez de inventar um limite", () => {
  const usage = extractContextUsage(
    resultEvent({ modelUsage: { "claude-sonnet-5": { canonicalModel: "claude-sonnet-5" } } }),
    "claude-sonnet-5",
    assistantUsage(),
  );
  assert.equal(usage, undefined);
});

test("modelUsage vazio ({}): retorna undefined em vez de quebrar no fallback", () => {
  const usage = extractContextUsage(resultEvent({ modelUsage: {} }), "claude-sonnet-5", assistantUsage());
  assert.equal(usage, undefined);
});

test("campos de usage ausentes no assistant contam como 0, não quebram a soma", () => {
  const usage = extractContextUsage(resultEvent(), "claude-sonnet-5", { cache_read_input_tokens: 500 });
  assert.deepEqual(usage, {
    model: "claude-sonnet-5",
    contextWindowSize: 1_000_000,
    usedTokens: 500,
  });
});

test("ignora o agregado do result.usage — nunca lê tokens de lá (achado real: soma tudo do turno, incluindo subagentes)", () => {
  // `result.usage` aqui simula o shape real que causou o bug de "104%"
  // reportado numa sessão de verdade: um número gigante que não representa
  // o contexto do fio principal. A função nem olha pra esse campo.
  const usage = extractContextUsage(
    resultEvent({
      usage: { input_tokens: 30, cache_creation_input_tokens: 36_139, cache_read_input_tokens: 1_402_133 },
    }),
    "claude-sonnet-5",
    assistantUsage(),
  );
  assert.deepEqual(usage, {
    model: "claude-sonnet-5",
    contextWindowSize: 1_000_000,
    usedTokens: 30693,
  });
});

test("isMainThreadEvent: true quando parent_tool_use_id é null ou ausente", () => {
  assert.equal(isMainThreadEvent({ type: "assistant", parent_tool_use_id: null }), true);
  assert.equal(isMainThreadEvent({ type: "assistant" }), true);
});

test("isMainThreadEvent: false quando parent_tool_use_id aponta pro tool_use que disparou um subagente", () => {
  // Shape real de um evento `assistant` de subagente, capturado rodando um
  // turno de verdade com `Task` — carrega `parent_tool_use_id`,
  // `subagent_type` e `task_description`, e um `usage` com contexto isolado
  // (cache_read_input_tokens: 0 — começa do zero, sem cache da conversa
  // principal). O ponto é só o `parent_tool_use_id`; os outros campos aqui
  // são só pra deixar o exemplo fiel ao real.
  assert.equal(
    isMainThreadEvent({
      type: "assistant",
      parent_tool_use_id: "toolu_01G3RYwin1us3gDnKrBpN2hv",
      subagent_type: "general-purpose",
    }),
    false,
  );
});
