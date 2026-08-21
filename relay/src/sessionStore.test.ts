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
    assert.deepEqual(persisted["com-historico"], {
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
