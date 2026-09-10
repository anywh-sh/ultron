// Builds the Go tailnet-sidecar into the name Tauri's `externalBin` expects
// (`binaries/tailnet-sidecar-<target-triple>`, plus `.exe` on Windows).
//
// This exists because forgetting it is silent and expensive: `tauri dev`
// happily bundles whatever binary is already sitting in `binaries/`, so a Go
// change appears to have no effect at all, and a Rust change that passes a
// flag the stale binary doesn't know makes the sidecar exit before printing
// LISTENING — which reads like a tailnet failure and is not one.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const clientDir = join(here, "..");

// Only the platforms this app is actually built for (journal/62 risk 2 tracks
// cross-platform CI for exactly this binary).
const TRIPLES = {
  "win32-x64": "x86_64-pc-windows-msvc",
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
};

const key = `${process.platform}-${process.arch}`;
const triple = TRIPLES[key];
if (!triple) {
  console.error(`no known Rust target triple for ${key} — add it to scripts/build-sidecar.mjs`);
  process.exit(1);
}

const outDir = join(clientDir, "src-tauri", "binaries");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `tailnet-sidecar-${triple}${process.platform === "win32" ? ".exe" : ""}`);

execFileSync("go", ["build", "-o", out, "./cmd/tailnet-sidecar"], {
  cwd: join(clientDir, "tailnet-sidecar"),
  stdio: "inherit",
});
console.log(`built ${out}`);
