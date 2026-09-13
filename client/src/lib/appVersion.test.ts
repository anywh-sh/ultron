import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { APP_VERSION } from "@/lib/appVersion";

/**
 * The version the status bar prints is a literal in the bundle, not
 * something read from Tauri at runtime (`appVersion.ts` explains why). That
 * buys a number available in every tier — unit tests, the webview, the real
 * app — at the price of a third place to bump on release. This is that
 * price, paid as a test instead of as a comment: shipping a build whose
 * status bar disagrees with the installer is exactly the kind of wrong that
 * nobody notices until a user quotes the wrong version in a bug report.
 */
// Resolved from the runner's cwd (always `client/`, where vitest.config.ts
// lives) — same reasoning as builtinThemes.test.ts's read of index.css.
function readJson(relativePath: string): { version?: string } {
  return JSON.parse(readFileSync(resolve(process.cwd(), relativePath), "utf8")) as { version?: string };
}

describe("app version", () => {
  it("matches the package the client is built from", () => {
    expect(APP_VERSION).toBe(readJson("package.json").version);
  });

  it("matches the version Tauri stamps on the bundle", () => {
    expect(APP_VERSION).toBe(readJson("src-tauri/tauri.conf.json").version);
  });
});
