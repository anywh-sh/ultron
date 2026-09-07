import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Separate from vite.config.ts on purpose: that one carries the Tailwind
// plugin and the Tauri dev-server options (fixed port, HMR over a specific
// host), neither of which a unit/component test needs — this only pulls in
// what rendering React components under happy-dom actually requires.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./tests/setup.ts"],
    // `tests/e2e/**` is driven by WebdriverIO against the real Tauri app
    // (`npm run test:e2e`, wdio.conf.js) — its `describe`/`it` come from
    // WebdriverIO's own global injection, not vitest's, so vitest's default
    // include pattern (`**/*.spec.*` among others) picking these files up
    // fails every one with "describe is not defined" instead of skipping
    // them. Confirmed breaking real CI runs (2026-09-07, first time `npm
    // test` ran in GitHub Actions against a client change) — not just a
    // local curiosity.
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
  },
});
