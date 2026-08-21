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

test("arquivo ausente: começa vazio, recordName semeia cwd padrão destravado", () => {
  withStoreFile(undefined, (filePath) => {
    const store = new SessionStore(filePath, DEFAULT_CWD);
    assert.deepEqual(store.listNames(), []);
    store.recordName("minha-sessao");
    assert.deepEqual(store.getCwdState("minha-sessao"), { cwd: DEFAULT_CWD, locked: false });
    assert.equal(store.getSessionId("minha-sessao"), undefined);
  });
});

test("migração: shape legado (nome -> session_id|null) vira o shape novo e repersiste", () => {
  withStoreFile({ "com-historico": "abc-123", "sem-turno-ainda": null }, (filePath) => {
    const store = new SessionStore(filePath, DEFAULT_CWD);

    // Sessão que já tinha session_id de verdade: trava (não arrisca o --resume dela).
    assert.deepEqual(store.getCwdState("com-historico"), { cwd: DEFAULT_CWD, locked: true });
    assert.equal(store.getSessionId("com-historico"), "abc-123");

    // Sessão sem session_id ainda: destravada.
    assert.deepEqual(store.getCwdState("sem-turno-ainda"), { cwd: DEFAULT_CWD, locked: false });
    assert.equal(store.getSessionId("sem-turno-ainda"), undefined);

    // Repersistiu no shape novo — reabrir não re-detecta como legado.
    const persisted = JSON.parse(readFileSync(filePath, "utf8"));
    assert.deepEqual(persisted["com-historico"], { sessionId: "abc-123", cwd: { cwd: DEFAULT_CWD, locked: true } });
  });
});

test("setCwd/lockCwd/getCwdState fazem round-trip e persistem em disco", () => {
  withStoreFile(undefined, (filePath) => {
    const store = new SessionStore(filePath, DEFAULT_CWD);
    store.recordName("s1");
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
    store.recordName("s1");
    store.setCwd("s1", "/tmp/projeto");
    store.recordSessionId("s1", "sess-1");
    assert.equal(store.getSessionId("s1"), "sess-1");
    assert.deepEqual(store.getCwdState("s1"), { cwd: "/tmp/projeto", locked: false });
  });
});
