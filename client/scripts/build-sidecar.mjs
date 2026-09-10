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
// cross-platform CI for exactly this binary). Keyed by Node's own
// platform-arch so the host case needs no translation.
const TARGETS = {
  "win32-x64": { triple: "x86_64-pc-windows-msvc", goos: "windows", goarch: "amd64" },
  "darwin-arm64": { triple: "aarch64-apple-darwin", goos: "darwin", goarch: "arm64" },
  "darwin-x64": { triple: "x86_64-apple-darwin", goos: "darwin", goarch: "amd64" },
  "linux-x64": { triple: "x86_64-unknown-linux-gnu", goos: "linux", goarch: "amd64" },
  "linux-arm64": { triple: "aarch64-unknown-linux-gnu", goos: "linux", goarch: "arm64" },
};

// `--target win32-x64` builds for another platform than this one. The sidecar
// is pure Go with no cgo, so this is a plain GOOS/GOARCH cross-build and
// needs no toolchain beyond Go itself — which means the machine that has Go
// can produce the binary for the machine that's doing the testing.
const targetFlag = process.argv.indexOf("--target");
const key = targetFlag === -1 ? `${process.platform}-${process.arch}` : process.argv[targetFlag + 1];

const target = TARGETS[key];
if (!target) {
  console.error(`unknown target ${key} — known: ${Object.keys(TARGETS).join(", ")}`);
  process.exit(1);
}

const outDir = join(clientDir, "src-tauri", "binaries");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `tailnet-sidecar-${target.triple}${target.goos === "windows" ? ".exe" : ""}`);

try {
  execFileSync("go", ["build", "-o", out, "./cmd/tailnet-sidecar"], {
    cwd: join(clientDir, "tailnet-sidecar"),
    stdio: "inherit",
    // CGO off so a cross-build never reaches for a C toolchain it doesn't
    // have; nothing here needs one on any platform.
    env: { ...process.env, GOOS: target.goos, GOARCH: target.goarch, CGO_ENABLED: "0" },
  });
} catch (err) {
  if (err.code === "ENOENT") {
    // The machine doing the testing doesn't necessarily have a Go toolchain,
    // and the raw spawn failure buries that under a stack trace.
    console.error(
      `Go is not installed on this machine, so the sidecar can't be built here.\n` +
        `Build it on a machine that has Go, with the same target:\n` +
        `  npm run build:sidecar -- --target ${key}\n` +
        `then copy the result to this machine as:\n` +
        `  ${out}\n` +
        `The file name has to match exactly — Tauri's externalBin looks it up by name.`,
    );
    process.exit(1);
  }
  throw err;
}
console.log(`built ${out}`);
