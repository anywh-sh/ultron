# anywh client

Desktop (Windows/macOS/Linux) and iOS client, built with React + TypeScript + Tailwind CSS + shadcn/ui on top of Tauri 2.0. Talks to the relay (`../relay`) over WebSocket.

See the root [README](../README.md) for how this fits into the rest of the project.

## Development

```bash
npm install
npm run build:sidecar  # required once before any Tauri build — see below
npm run dev            # Vite dev server (browser preview, no Tauri APIs)
npm run tauri dev      # full desktop app
```

`build:sidecar` compiles `tailnet-sidecar/` (Go) into the name Tauri's
`externalBin` expects. It isn't committed, so a fresh clone fails in
`build.rs` without it, and re-running it after a Go change is on you —
Tauri bundles whatever stale binary is already in `src-tauri/binaries/`.
Details and cross-building in
[Self-hosting](../docs/self-hosting.md#the-sidecar-step-is-not-optional).

## iOS

```bash
npm run ios:device                       # Simulator, or prompts for a connected device
npm run ios:device -- "My iPhone"        # a specific physical device by name
```

If you always target the same physical device, drop a `*.local.sh` script in
this directory (gitignored — see `.gitignore`) instead of typing the device
name every time, e.g.:

```bash
#!/usr/bin/env bash
exec npm run ios:device -- "My iPhone"
```
