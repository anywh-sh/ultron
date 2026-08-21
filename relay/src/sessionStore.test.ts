import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "./sessionStore.js";

const DEFAULT_CWD = "/home/user";

function withStoreFile(seed: unknown, run: (filePath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "ultron-sessionstore-test-"));
  const filePath = join(dir, "sessions.json");
  try {
    if (seed !== undefined) writeFileSync(filePath, JSON.stringify(seed));
    run(filePath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("arquivo ausente: começa vazio, recordId semeia cwd padrão destravado e sem título", () => {
  withStoreFile(undefined, (filePath) => {
    const store = new SessionStore(filePath, DEFAULT_CWD);
    assert.deepEqual(store.listIds(), []);
    assert.deepEqual(store.listTitled(), []);
    store.recordId("abc-123");
    assert.deepEqual(store.getCwdState("abc-123"), { cwd: DEFAULT_CWD, locked: false });
    assert.equal(store.getSessionId("abc-123"), undefined);
    assert.equal(store.getTitle("abc-123"), null);
    assert.deepEqual(store.listTitled(), []);
  });
});

test("setTitle grava o título e a sessão passa a aparecer em listTitled", () => {
  withStoreFile(undefined, (filePath) => {
    const store = new SessionStore(filePath, DEFAULT_CWD);
    store.recordId("abc-123");
    store.setTitle("abc-123", "Corrigir bug do botão salvar");
    assert.equal(store.getTitle("abc-123"), "Corrigir bug do botão salvar");
    assert.deepEqual(store.listTitled(), [{ id: "abc-123", title: "Corrigir bug do botão salvar" }]);
  });
});

test("migração: shape legado (nome -> session_id|null) vira o shape novo com título = nome antigo", () => {
  withStoreFile({ "com-historico": "abc-123", "sem-turno-ainda": null }, (filePath) => {
    const store = new SessionStore(filePath, DEFAULT_CWD);

    // Sessão que já tinha session_id de verdade: trava (não arrisca o --resume dela).
    assert.deepEqual(store.getCwdState("com-historico"), { cwd: DEFAULT_CWD, locked: true });
    assert.equal(store.getSessionId("com-historico"), "abc-123");
    assert.equal(store.getTitle("com-historico"), "com-historico");

    // Sessão sem session_id ainda: destravada, mas já titulada com o próprio nome.
    assert.deepEqual(store.getCwdState("sem-turno-ainda"), { cwd: DEFAULT_CWD, locked: false });
    assert.equal(store.getSessionId("sem-turno-ainda"), undefined);
    assert.equal(store.getTitle("sem-turno-ainda"), "sem-turno-ainda");

    // Repersistiu no shape novo — reabrir não re-detecta como legado.
    const persisted = JSON.parse(readFileSync(filePath, "utf8"));
    const { lastActiveAt, ...rest } = persisted["com-historico"];
    assert.equal(typeof lastActiveAt, "number");
    assert.deepEqual(rest, {
      sessionId: "abc-123",
      title: "com-historico",
      cwd: { cwd: DEFAULT_CWD, locked: true },
    });
  });
});

test("migração: shape pré-título (sem campo title) ganha título = id", () => {
  withStoreFile(
    { s1: { sessionId: "sess-1", cwd: { cwd: "/tmp/projeto", locked: true } } },
    (filePath) => {
      const store = new SessionStore(filePath, DEFAULT_CWD);
      assert.equal(store.getTitle("s1"), "s1");
      assert.equal(store.getSessionId("s1"), "sess-1");
      assert.deepEqual(store.getCwdState("s1"), { cwd: "/tmp/projeto", locked: true });
    },
  );
});

test("migração: shape pré-atividade (com title, sem lastActiveAt) ganha lastActiveAt", () => {
  withStoreFile(
    { s1: { sessionId: "sess-1", title: "Sessão 1", cwd: { cwd: "/tmp/projeto", locked: true } } },
    (filePath) => {
      const store = new SessionStore(filePath, DEFAULT_CWD);
      assert.deepEqual(store.listTitled(), [{ id: "s1", title: "Sessão 1" }]);
      const persisted = JSON.parse(readFileSync(filePath, "utf8"));
      assert.equal(typeof persisted.s1.lastActiveAt, "number");
    },
  );
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("listTitled ordena por lastActiveAt decrescente (mais recente primeiro)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ultron-sessionstore-test-"));
  try {
    const filePath = join(dir, "sessions.json");
    const store = new SessionStore(filePath, DEFAULT_CWD);

    // `setTimeout` entre cada operação: `Date.now()` tem resolução de 1ms,
    // chamadas síncronas seguidas quase sempre empatam no mesmo
    // milissegundo — sem o delay, o teste ficaria dependente de sorte.
    store.recordId("s1");
    store.setTitle("s1", "Primeira");
    await sleep(5);
    store.recordId("s2");
    store.setTitle("s2", "Segunda");
    await sleep(5);
    store.recordId("s3");
    store.setTitle("s3", "Terceira");

    // Sem tocar em nada, a ordem segue a de criação (mais recente primeiro).
    assert.deepEqual(
      store.listTitled().map((s) => s.id),
      ["s3", "s2", "s1"],
    );

    // Reabrir a mais antiga (s1) sobe ela pro topo.
    await sleep(5);
    store.touch("s1");
    assert.deepEqual(
      store.listTitled().map((s) => s.id),
      ["s1", "s3", "s2"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deleteEntry remove a sessão e devolve false se já não existia", () => {
  withStoreFile(undefined, (filePath) => {
    const store = new SessionStore(filePath, DEFAULT_CWD);
    store.recordId("s1");
    store.setTitle("s1", "Sessão 1");
    assert.equal(store.deleteEntry("s1"), true);
    assert.deepEqual(store.listTitled(), []);
    assert.equal(store.getTitle("s1"), null);
    assert.equal(store.deleteEntry("s1"), false);

    // Reabrir o arquivo reflete a remoção.
    const reopened = new SessionStore(filePath, DEFAULT_CWD);
    assert.deepEqual(reopened.listIds(), []);
  });
});

test("setCwd/lockCwd/getCwdState fazem round-trip e persistem em disco", () => {
  withStoreFile(undefined, (filePath) => {
    const store = new SessionStore(filePath, DEFAULT_CWD);
    store.recordId("s1");
    store.setCwd("s1", "/home/user/mode/widgets");
    assert.deepEqual(store.getCwdState("s1"), { cwd: "/home/user/mode/widgets", locked: false });

    store.lockCwd("s1");
    assert.deepEqual(store.getCwdState("s1"), { cwd: "/home/user/mode/widgets", locked: true });

    // Reabrir o arquivo reflete o que foi persistido.
    const reopened = new SessionStore(filePath, DEFAULT_CWD);
    assert.deepEqual(reopened.getCwdState("s1"), { cwd: "/home/user/mode/widgets", locked: true });
  });
});

test("recordSessionId grava o id sem mexer no cwd já escolhido", () => {
  withStoreFile(undefined, (filePath) => {
    const store = new SessionStore(filePath, DEFAULT_CWD);
    store.recordId("s1");
    store.setCwd("s1", "/tmp/projeto");
    store.recordSessionId("s1", "sess-1");
    assert.equal(store.getSessionId("s1"), "sess-1");
    assert.deepEqual(store.getCwdState("s1"), { cwd: "/tmp/projeto", locked: false });
  });
});
