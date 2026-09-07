import path from "node:path";
import { defineConfig } from "vitest/config";
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
  },
});
