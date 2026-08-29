import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { ClaudeEvent } from "./claudeSession.js";
import {
  BackgroundJobTracker,
  extractStartedJobFromEvent,
  parseStartedMarker,
  type FinishedBackgroundJob,
} from "./backgroundJobs.js";

const STARTED_JSON =
  '{"ultron_bg":"started","id":"1788022610814662237-29477","pid":1200509,' +
  '"log":"/home/user/.ultron/bg-jobs/1788022610814662237-29477.log",' +
  '"exitFile":"/home/user/.ultron/bg-jobs/1788022610814662237-29477.exit","label":"sleep-build-stub"}';

// ---- parseStartedMarker -----------------------------------------------

test("parseStartedMarker: reconhece o marcador quando é a string inteira", () => {
  assert.deepEqual(parseStartedMarker(STARTED_JSON), {
    id: "1788022610814662237-29477",
    pid: 1200509,
    log: "/home/user/.ultron/bg-jobs/1788022610814662237-29477.log",
    exitFile: "/home/user/.ultron/bg-jobs/1788022610814662237-29477.exit",
    label: "sleep-build-stub",
  });
});

test("parseStartedMarker: reconhece o marcador com uma quebra de linha depois (saída real do printf)", () => {
  assert.deepEqual(parseStartedMarker(STARTED_JSON + "\n"), {
    id: "1788022610814662237-29477",
    pid: 1200509,
    log: "/home/user/.ultron/bg-jobs/1788022610814662237-29477.log",
    exitFile: "/home/user/.ultron/bg-jobs/1788022610814662237-29477.exit",
    label: "sleep-build-stub",
  });
});

test("parseStartedMarker: texto sem o marcador retorna undefined", () => {
  assert.equal(parseStartedMarker("build ok\nexit 0"), undefined);
});

test("parseStartedMarker: JSON parecido mas com ultron_bg diferente de \"started\" retorna undefined", () => {
  assert.equal(parseStartedMarker('{"ultron_bg":"status","id":"x","done":true}'), undefined);
});

test("parseStartedMarker: campo obrigatório faltando (pid) retorna undefined em vez de quebrar", () => {
  assert.equal(
    parseStartedMarker('{"ultron_bg":"started","id":"x","log":"a","exitFile":"b","label":"c"}'),
    undefined,
  );
});

test("parseStartedMarker: JSON malformado (truncado) retorna undefined, não lança", () => {
  assert.equal(parseStartedMarker('{"ultron_bg":"started","id":"x"'), undefined);
});

// ---- extractStartedJobFromEvent ----------------------------------------

function toolResultEvent(content: unknown): ClaudeEvent {
  return {
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content }] },
  };
}

test("extractStartedJobFromEvent: tool_result com content string (shape mais comum, confirmado contra o binário real)", () => {
  const job = extractStartedJobFromEvent(toolResultEvent(STARTED_JSON));
  assert.equal(job?.id, "1788022610814662237-29477");
  assert.equal(job?.label, "sleep-build-stub");
});

test("extractStartedJobFromEvent: tool_result com content em array de blocos de texto (shape alternativo permitido pela API)", () => {
  const job = extractStartedJobFromEvent(toolResultEvent([{ type: "text", text: STARTED_JSON }]));
  assert.equal(job?.id, "1788022610814662237-29477");
});

test("extractStartedJobFromEvent: evento assistant (não user/tool_result) retorna undefined", () => {
  const event: ClaudeEvent = { type: "assistant", message: { content: [{ type: "text", text: STARTED_JSON }] } };
  assert.equal(extractStartedJobFromEvent(event), undefined);
});

test("extractStartedJobFromEvent: tool_result de outra ferramenta (sem o marcador) retorna undefined", () => {
  assert.equal(extractStartedJobFromEvent(toolResultEvent("arquivo.txt criado")), undefined);
});

test("extractStartedJobFromEvent: user event sem content array (ex: {}) não lança", () => {
  const event: ClaudeEvent = { type: "user", message: {} };
  assert.equal(extractStartedJobFromEvent(event), undefined);
});

// ---- BackgroundJobTracker -----------------------------------------------

function withJobFiles(run: (dir: string, logPath: string, exitPath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "ultron-bgjobs-test-"));
  try {
    run(dir, join(dir, "job.log"), join(dir, "job.exit"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function startedEvent(id: string, log: string, exitFile: string, label = "teste", pid = 12345): ClaudeEvent {
  return toolResultEvent(
    JSON.stringify({ ultron_bg: "started", id, pid, log, exitFile, label }),
  );
}

test("BackgroundJobTracker: job ainda sem .exit não dispara onFinished e continua na lista", () => {
  withJobFiles((_dir, logPath, exitPath) => {
    writeFileSync(logPath, "rodando...\n");
    const finished: FinishedBackgroundJob[] = [];
    const tracker = new BackgroundJobTracker({ onFinished: (job) => finished.push(job) });
    tracker.observeEvent("sess-1", startedEvent("job-1", logPath, exitPath));
    tracker.pollOnce();
    assert.equal(finished.length, 0);
    assert.equal(tracker.listWatched().length, 1);
    tracker.stopPolling();
  });
});

test("BackgroundJobTracker: .exit aparecendo dispara onFinished com exitCode e cauda do log, e para de observar", () => {
  withJobFiles((_dir, logPath, exitPath) => {
    writeFileSync(logPath, "build ok\n");
    writeFileSync(exitPath, "0\n");
    const finished: FinishedBackgroundJob[] = [];
    const tracker = new BackgroundJobTracker({ onFinished: (job) => finished.push(job) });
    tracker.observeEvent("sess-1", startedEvent("job-1", logPath, exitPath, "meu-build"));
    tracker.pollOnce();
    assert.equal(finished.length, 1);
    assert.equal(finished[0]?.exitCode, 0);
    assert.equal(finished[0]?.logTail, "build ok\n");
    assert.equal(finished[0]?.label, "meu-build");
    assert.equal(finished[0]?.sessionId, "sess-1");
    assert.equal(tracker.listWatched().length, 0);
    tracker.stopPolling();
  });
});

test("BackgroundJobTracker: exit code diferente de zero também é reportado (não é tratado como falha do tracker)", () => {
  withJobFiles((_dir, logPath, exitPath) => {
    writeFileSync(logPath, "erro: arquivo não encontrado\n");
    writeFileSync(exitPath, "1\n");
    const finished: FinishedBackgroundJob[] = [];
    const tracker = new BackgroundJobTracker({ onFinished: (job) => finished.push(job) });
    tracker.observeEvent("sess-1", startedEvent("job-1", logPath, exitPath));
    tracker.pollOnce();
    assert.equal(finished[0]?.exitCode, 1);
    tracker.stopPolling();
  });
});

test("BackgroundJobTracker: cauda do log respeita logTailBytes (não devolve o arquivo inteiro)", () => {
  withJobFiles((_dir, logPath, exitPath) => {
    writeFileSync(logPath, "a".repeat(10_000));
    writeFileSync(exitPath, "0");
    const finished: FinishedBackgroundJob[] = [];
    const tracker = new BackgroundJobTracker({ onFinished: (job) => finished.push(job), logTailBytes: 100 });
    tracker.observeEvent("sess-1", startedEvent("job-1", logPath, exitPath));
    tracker.pollOnce();
    assert.equal(finished[0]?.logTail.length, 100);
    tracker.stopPolling();
  });
});

test("BackgroundJobTracker: mesmo id observado duas vezes (evento duplicado) não vira dois jobs watched", () => {
  withJobFiles((_dir, logPath, exitPath) => {
    writeFileSync(logPath, "rodando...\n");
    const tracker = new BackgroundJobTracker({ onFinished: () => undefined });
    const event = startedEvent("job-1", logPath, exitPath);
    tracker.observeEvent("sess-1", event);
    tracker.observeEvent("sess-1", event);
    assert.equal(tracker.listWatched().length, 1);
    tracker.stopPolling();
  });
});

test("BackgroundJobTracker: job que passa do teto de observação (maxWatchMs) é descartado sem disparar onFinished", async () => {
  // Não usa `withJobFiles` aqui: precisa manter o diretório vivo através de
  // um `setTimeout` real (a limpeza síncrona no `finally` do helper rodaria
  // antes do poll, apagando os arquivos cedo demais).
  const dir = mkdtempSync(join(tmpdir(), "ultron-bgjobs-test-"));
  try {
    const logPath = join(dir, "job.log");
    const exitPath = join(dir, "job.exit");
    writeFileSync(logPath, "servidor de dev rodando pra sempre\n");
    // sem .exit — nunca termina, exatamente o caso do teto

    const finished: FinishedBackgroundJob[] = [];
    const tracker = new BackgroundJobTracker({ onFinished: (job) => finished.push(job), maxWatchMs: 1 });
    tracker.observeEvent("sess-1", startedEvent("job-1", logPath, exitPath));
    assert.equal(tracker.listWatched().length, 1);

    // espera real pra garantir que o teto de 1ms já passou antes do poll
    // (sem isso, dependendo do timing da máquina, o teste ficaria flaky).
    await new Promise((resolve) => setTimeout(resolve, 20));

    tracker.pollOnce();
    assert.equal(finished.length, 0);
    assert.equal(tracker.listWatched().length, 0);
    tracker.stopPolling();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("BackgroundJobTracker: dois jobs da mesma sessão são observados/concluídos independentemente", () => {
  withJobFiles((dir, _logPath, _exitPath) => {
    const logA = join(dir, "a.log");
    const exitA = join(dir, "a.exit");
    const logB = join(dir, "b.log");
    const exitB = join(dir, "b.exit");
    writeFileSync(logA, "a ok\n");
    writeFileSync(exitA, "0");
    writeFileSync(logB, "b rodando...\n");

    const finished: FinishedBackgroundJob[] = [];
    const tracker = new BackgroundJobTracker({ onFinished: (job) => finished.push(job) });
    tracker.observeEvent("sess-1", startedEvent("job-a", logA, exitA, "job-a"));
    tracker.observeEvent("sess-1", startedEvent("job-b", logB, exitB, "job-b"));
    tracker.pollOnce();

    assert.equal(finished.length, 1);
    assert.equal(finished[0]?.label, "job-a");
    assert.equal(tracker.listWatched().length, 1);
    assert.equal(tracker.listWatched()[0]?.label, "job-b");
    tracker.stopPolling();
  });
});

// ---- persistência em disco (Fase F) --------------------------------------

test("BackgroundJobTracker: com persistPath, um job observado sobrevive a um novo tracker (simula restart do relay)", () => {
  withJobFiles((dir, logPath, exitPath) => {
    writeFileSync(logPath, "rodando...\n");
    const persistPath = join(dir, "watched.json");

    const trackerA = new BackgroundJobTracker({ onFinished: () => undefined, persistPath });
    trackerA.observeEvent("sess-1", startedEvent("job-1", logPath, exitPath, "sobrevive-restart"));
    assert.equal(trackerA.listWatched().length, 1);
    trackerA.stopPolling();

    // "Restart do relay": um tracker NOVO, mesmo persistPath — nunca viu o
    // evento de início, só o que sobrou em disco.
    const finishedB: FinishedBackgroundJob[] = [];
    const trackerB = new BackgroundJobTracker({ onFinished: (job) => finishedB.push(job), persistPath });
    assert.equal(trackerB.listWatched().length, 1);
    assert.equal(trackerB.listWatched()[0]?.label, "sobrevive-restart");
    assert.equal(trackerB.listWatched()[0]?.pid, 12345);

    // job na verdade já tinha terminado enquanto o tracker A "estava fora
    // do ar" — trackerB precisa descobrir isso sem esperar o poll normal.
    writeFileSync(exitPath, "0");
    trackerB.pollOnce();
    assert.equal(finishedB.length, 1);
    assert.equal(trackerB.listWatched().length, 0);
    trackerB.stopPolling();

    // arquivo de persistência também reflete a conclusão (não fica com um
    // job fantasma que um TERCEIRO restart ressuscitaria de novo).
    const persisted = JSON.parse(readFileSync(persistPath, "utf8")) as unknown[];
    assert.equal(persisted.length, 0);
  });
});

test("BackgroundJobTracker: sem persistPath, comportamento continua só-em-memória (nenhum arquivo criado)", () => {
  withJobFiles((dir, logPath, exitPath) => {
    writeFileSync(logPath, "rodando...\n");
    const tracker = new BackgroundJobTracker({ onFinished: () => undefined });
    tracker.observeEvent("sess-1", startedEvent("job-1", logPath, exitPath));
    assert.equal(existsSync(join(dir, "watched.json")), false);
    tracker.stopPolling();
  });
});

test("BackgroundJobTracker: persistPath ausente ou corrompido começa vazio, não lança", () => {
  const dir = mkdtempSync(join(tmpdir(), "ultron-bgjobs-test-"));
  try {
    const missing = join(dir, "não-existe.json");
    const trackerMissing = new BackgroundJobTracker({ onFinished: () => undefined, persistPath: missing });
    assert.equal(trackerMissing.listWatched().length, 0);
    trackerMissing.stopPolling();

    const corrupted = join(dir, "corrompido.json");
    writeFileSync(corrupted, "isto não é json{{{");
    const trackerCorrupted = new BackgroundJobTracker({ onFinished: () => undefined, persistPath: corrupted });
    assert.equal(trackerCorrupted.listWatched().length, 0);
    trackerCorrupted.stopPolling();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- cancel (Fase F) ------------------------------------------------------

test("BackgroundJobTracker: cancel mata o processo de verdade, remove da lista e NÃO dispara onFinished", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ultron-bgjobs-test-"));
  try {
    const logPath = join(dir, "job.log");
    const exitPath = join(dir, "job.exit");
    writeFileSync(logPath, "");

    // `detached: true` faz o Node chamar `setsid()` no filho — mesma
    // topologia do `ultron-bg` real (o PID do processo já é o PGID/SID do
    // grupo), então `process.kill(-pid, ...)` alcança ele do mesmo jeito.
    const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
    const pid = child.pid;
    assert.ok(pid, "spawn deveria ter retornado um PID");

    const finished: FinishedBackgroundJob[] = [];
    const tracker = new BackgroundJobTracker({ onFinished: (job) => finished.push(job) });
    tracker.observeEvent("sess-1", startedEvent("job-1", logPath, exitPath, "sleep-cancelavel", pid));
    assert.equal(tracker.listWatched().length, 1);

    const ok = tracker.cancel("sess-1", "job-1");
    assert.equal(ok, true);
    assert.equal(tracker.listWatched().length, 0, "cancel deve remover o job da lista na hora, sem esperar o processo morrer");

    await new Promise((resolve) => setTimeout(resolve, 500));
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    assert.equal(alive, false, "o processo real deveria ter sido morto pelo cancel");
    assert.equal(finished.length, 0, "cancel não deve disparar onFinished — quem cancelou já sabe que cancelou");

    tracker.stopPolling();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("BackgroundJobTracker: cancel de um id que não existe (ou já terminou) retorna false sem lançar", () => {
  const tracker = new BackgroundJobTracker({ onFinished: () => undefined });
  assert.equal(tracker.cancel("sess-1", "job-fantasma"), false);
  tracker.stopPolling();
});
