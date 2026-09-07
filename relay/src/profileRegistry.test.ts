import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  allocatePort,
  envFileFor,
  findHomeOverrideCollision,
  isValidProfileId,
  listProfiles,
  slugify,
} from "./profileRegistry.js";

// `envDir` nested one level under the unique tmp root (mirrors the real
// `~/.config/ultron/{env,profiles.json}` layout) — `mkdtempSync` alone
// creates directly under the shared `os.tmpdir()`, so `dirname(envDir)`
// would resolve to that shared `/tmp`, and every test's `profiles.json`
// would collide on the same path instead of each getting its own.
function withTempDir(run: (envDir: string) => void | Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "ultron-profile-registry-test-"));
  const envDir = join(root, "env");
  mkdirSync(envDir);
  return Promise.resolve(run(envDir)).finally(() => rmSync(root, { recursive: true, force: true }));
}

function writeEnv(envDir: string, id: string, values: Record<string, string>): void {
  const body = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  writeFileSync(envFileFor(id, envDir), body);
}

test("isValidProfileId: accepts lowercase alphanumeric + hyphen, rejects the rest", () => {
  assert.equal(isValidProfileId("trabalho"), true);
  assert.equal(isValidProfileId("trabalho-2"), true);
  assert.equal(isValidProfileId("a1"), true);
  assert.equal(isValidProfileId(""), false);
  assert.equal(isValidProfileId("-trabalho"), false);
  assert.equal(isValidProfileId("Trabalho"), false);
  assert.equal(isValidProfileId("trabalho novo"), false);
  assert.equal(isValidProfileId("a".repeat(33)), false);
});

test("slugify: strips accents, lowercases, collapses separators", () => {
  assert.equal(slugify("João Ação", []), "joao-acao");
  assert.equal(slugify("  Cliente   X!! ", []), "cliente-x");
});

test("slugify: appends -2/-3 on collision, keeps first-come untouched", () => {
  assert.equal(slugify("Trabalho", []), "trabalho");
  assert.equal(slugify("Trabalho", ["trabalho"]), "trabalho-2");
  assert.equal(slugify("Trabalho", ["trabalho", "trabalho-2"]), "trabalho-3");
});

test("slugify: caps length at 32 chars", () => {
  const result = slugify("a".repeat(50), []);
  assert.equal(result.length, 32);
});

test("listProfiles: a profile with no profiles.json entry falls back to id as label and position as colorIndex", async () => {
  await withTempDir(async (envDir) => {
    writeEnv(envDir, "pessoal", { RELAY_PORT: "9001", RELAY_HOST: "127.0.0.1" });
    writeEnv(envDir, "trabalho", { RELAY_PORT: "9002", RELAY_HOST: "127.0.0.1", RELAY_HOME_OVERRIDE: "/tmp/fake-home" });

    const profiles = await listProfiles(envDir);
    assert.equal(profiles.length, 2);

    const pessoal = profiles.find((p) => p.id === "pessoal");
    assert.ok(pessoal);
    assert.equal(pessoal.label, "pessoal");
    assert.equal(pessoal.hasHomeOverride, false);
    assert.equal(pessoal.running, false);

    const trabalho = profiles.find((p) => p.id === "trabalho");
    assert.ok(trabalho);
    assert.equal(trabalho.hasHomeOverride, true);
  });
});

test("listProfiles: profiles.json overrides label and colorIndex", async () => {
  await withTempDir(async (envDir) => {
    writeEnv(envDir, "pessoal", { RELAY_PORT: "9001", RELAY_HOST: "127.0.0.1" });
    writeFileSync(
      join(envDir, "..", "profiles.json"),
      JSON.stringify({
        version: 1,
        profiles: [{ id: "pessoal", label: "Pessoal", colorIndex: 3, createdAt: "now", updatedAt: "now" }],
      }),
    );

    const profiles = await listProfiles(envDir);
    assert.equal(profiles[0].label, "Pessoal");
    assert.equal(profiles[0].colorIndex, 3);
  });
});

test("listProfiles: ignores a .env file without RELAY_PORT", async () => {
  await withTempDir(async (envDir) => {
    writeEnv(envDir, "broken", { RELAY_HOST: "127.0.0.1" });
    const profiles = await listProfiles(envDir);
    assert.equal(profiles.length, 0);
  });
});

test("findHomeOverrideCollision: matches a differently-written path to the same real directory", async () => {
  await withTempDir(async (envDir) => {
    writeEnv(envDir, "trabalho", { RELAY_PORT: "9002", RELAY_HOME_OVERRIDE: "/tmp/fake-home" });
    assert.equal(findHomeOverrideCollision("/tmp/fake-home/", envDir), "trabalho");
    assert.equal(findHomeOverrideCollision("/tmp/other-home", envDir), undefined);
  });
});

test("findHomeOverrideCollision: absence of RELAY_HOME_OVERRIDE means the real $HOME, a comparable value", async () => {
  await withTempDir(async (envDir) => {
    writeEnv(envDir, "pessoal", { RELAY_PORT: "9001" });
    assert.equal(findHomeOverrideCollision(undefined, envDir), "pessoal");
  });
});

test("allocatePort: skips a port already claimed by an existing .env file", async () => {
  await withTempDir(async (envDir) => {
    writeEnv(envDir, "pessoal", { RELAY_PORT: "8765" });
    const port = await allocatePort(envDir);
    assert.notEqual(port, 8765);
  });
});
