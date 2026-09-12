import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Same environment as vitest.config.ts, different file set: the perf harness
// (tests/perf/*.perf.tsx) prints a report instead of guarding a threshold, so
// it must not run as part of `npm test` — timing assertions on shared CI
// hardware are how a suite becomes flaky. `npm run perf` runs it on demand.
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
    include: ["tests/perf/**/*.perf.tsx"],
    // Without this, vitest buffers console output and only surfaces it for a
    // *failing* test — this harness reports through a passing one.
    disableConsoleIntercept: true,
    // A single worker, so two files never contend for the same core while
    // being timed.
    fileParallelism: false,
  },
});
