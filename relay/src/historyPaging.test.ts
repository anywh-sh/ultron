import { test } from "node:test";
import assert from "node:assert/strict";
import { pageHistoryBefore } from "./historyPaging.js";
import type { BroadcastMessage } from "./sharedSession.js";

function userPrompt(text: string): BroadcastMessage {
  return { type: "claude_event", event: { type: "user_prompt", message: { content: [{ type: "text", text }] } } };
}

function assistantText(text: string): BroadcastMessage {
  return { type: "claude_event", event: { type: "assistant", message: { content: [{ type: "text", text }] } } };
}

const turnComplete: BroadcastMessage = { type: "turn_complete", stopped: false };
const turnError: BroadcastMessage = { type: "turn_error", message: "deu ruim" };

/** N turnos completos, cada um com 2 eventos + terminador (3 mensagens por
 * turno) — o suficiente pra exercitar corte no meio de vários turnos. */
function buildTurns(n: number): BroadcastMessage[] {
  const history: BroadcastMessage[] = [];
  for (let i = 0; i < n; i++) {
    history.push(userPrompt(`pergunta ${i}`), assistantText(`resposta ${i}`), turnComplete);
  }
  return history;
}

test("história vazia: página vazia, sem mais nada pra buscar", () => {
  const page = pageHistoryBefore([], 0, 20);
  assert.deepEqual(page, { messages: [], cursor: 0, hasMore: false });
});

test("menos turnos que o teto: manda tudo, hasMore false (comportamento idêntico ao replay antigo)", () => {
  const history = buildTurns(5);
  const page = pageHistoryBefore(history, history.length, 20);
  assert.deepEqual(page.messages, history);
  assert.equal(page.cursor, 0);
  assert.equal(page.hasMore, false);
});

test("exatamente o teto de turnos: ainda manda tudo, hasMore false (limite não é off-by-one)", () => {
  const history = buildTurns(20);
  const page = pageHistoryBefore(history, history.length, 20);
  assert.deepEqual(page.messages, history);
  assert.equal(page.hasMore, false);
});

test("mais turnos que o teto: manda só a cauda, hasMore true, cursor no início do turno certo", () => {
  const history = buildTurns(25);
  const page = pageHistoryBefore(history, history.length, 20);
  assert.equal(page.hasMore, true);
  // Os 20 turnos mais recentes são os turnos 5..24 (0-indexado) — cada turno
  // tem 3 mensagens, então o turno 5 começa no índice 15.
  assert.equal(page.cursor, 15);
  assert.deepEqual(page.messages, history.slice(15));
  assert.deepEqual(page.messages[0], userPrompt("pergunta 5"));
});

test("turno em andamento (sem terminador no fim) entra na página como o turno mais recente", () => {
  const history = [...buildTurns(3), userPrompt("pergunta em andamento"), assistantText("resposta parcial")];
  const page = pageHistoryBefore(history, history.length, 20);
  assert.deepEqual(page.messages, history);
  assert.equal(page.hasMore, false);
});

test("turn_error também fecha um turno, igual turn_complete", () => {
  const history = [userPrompt("p1"), assistantText("r1"), turnError, userPrompt("p2"), assistantText("r2"), turnComplete];
  const page = pageHistoryBefore(history, history.length, 1);
  assert.equal(page.cursor, 3);
  assert.deepEqual(page.messages, history.slice(3));
});

test("load_older_history: cursor de uma página busca a página anterior, sem sobrepor nem pular turno", () => {
  const history = buildTurns(45);
  const first = pageHistoryBefore(history, history.length, 20);
  assert.equal(first.hasMore, true);

  const second = pageHistoryBefore(history, first.cursor, 20);
  assert.equal(second.hasMore, true); // ainda sobram 5 turnos (45 - 20 - 20)
  assert.deepEqual(second.messages, history.slice(second.cursor, first.cursor));

  const third = pageHistoryBefore(history, second.cursor, 20);
  assert.equal(third.hasMore, false); // os 5 turnos restantes, do início
  assert.equal(third.cursor, 0);
  assert.deepEqual([...third.messages, ...second.messages, ...first.messages], history);
});
