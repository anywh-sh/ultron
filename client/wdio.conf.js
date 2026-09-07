import { resolve } from "node:path";

// Real end-to-end tier (.ultron/skills/tests/SKILL.md) — drives the actual
// Tauri app (real window, real webview) via @wdio/tauri-service's embedded
// provider, which needs no external driver on any platform (unlike the
// older tauri-driver, Linux/Windows only). The binary must already be built
// with the `e2e` Cargo feature (client/src-tauri/Cargo.toml) and the
// tauri.e2e.conf.json capabilities override:
//
//   npx tauri build --debug --no-bundle --features e2e --config src-tauri/tauri.e2e.conf.json
//
// Neither the feature nor the extra capability is present in a normal
// `tauri dev`/`tauri build` — this is an opt-in, e2e-only binary.
const appBinaryPath = resolve(import.meta.dirname, "src-tauri/target/debug/ultron");

export const config = {
  runner: "local",
  specs: ["./tests/e2e/*.spec.js"],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "tauri",
      "wdio:enforceWebDriverClassic": true,
      "tauri:options": { application: appBinaryPath },
      "wdio:tauriServiceOptions": {
        appBinaryPath,
        driverProvider: "embedded",
      },
    },
  ],
  logLevel: "info",
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  services: [["@wdio/tauri-service", { driverProvider: "embedded" }]],
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 60000,
  },
};
