import { test } from "node:test";
import assert from "node:assert/strict";
import { findEditTarget, pageHistoryBefore } from "./historyPaging.js";
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

function syntheticBackgroundJobPrompt(label: string): BroadcastMessage {
  return {
    type: "claude_event",
    event: { type: "user_prompt", synthetic: "background_job", label, message: { content: [{ type: "text", text: "..." }] } },
  };
}

test("findEditTarget: fromEnd 1 acha a última mensagem, cutIndex no início do turno", () => {
  const history = buildTurns(3);
  const target = findEditTarget(history, 1);
  assert.deepEqual(target, { cutIndex: 6, turnsBefore: 2 });
});

test("findEditTarget: fromEnd maior conta turnos mais antigos", () => {
  const history = buildTurns(3);
  const target = findEditTarget(history, 3);
  assert.deepEqual(target, { cutIndex: 0, turnsBefore: 0 });
});

test("findEditTarget: fromEnd além do que existe devolve undefined (pedido inválido)", () => {
  const history = buildTurns(3);
  assert.equal(findEditTarget(history, 4), undefined);
  assert.equal(findEditTarget([], 1), undefined);
});

test("findEditTarget: pula turnos sintéticos de ultron-bg ao contar do fim", () => {
  const history = [
    ...buildTurns(2), // turno real 0, turno real 1
    syntheticBackgroundJobPrompt("job x"),
    assistantText("resumo do job"),
    turnComplete,
    userPrompt("pergunta real mais recente"),
    assistantText("resposta"),
    turnComplete,
  ];
  // fromEnd=1 deve achar "pergunta real mais recente" (pula o turno sintético
  // antes dele), não o turno sintético em si.
  const last = findEditTarget(history, 1);
  assert.deepEqual(history[last!.cutIndex], userPrompt("pergunta real mais recente"));
  // turnsBefore conta TODOS os turnos antes (2 reais + 1 sintético = 3),
  // porque cada um vira exatamente uma linha no .jsonl real.
  assert.equal(last!.turnsBefore, 3);

  // fromEnd=2 deve pular o sintético e achar o turno real 1 (buildTurns).
  const secondFromEnd = findEditTarget(history, 2);
  assert.deepEqual(history[secondFromEnd!.cutIndex], userPrompt("pergunta 1"));
  assert.equal(secondFromEnd!.turnsBefore, 1);
});
