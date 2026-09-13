# anywh client

Desktop (Windows/macOS/Linux) and iOS client, built with React + TypeScript + Tailwind CSS + shadcn/ui on top of Tauri 2.0. Talks to the relay (`../relay`) over WebSocket.

See the root [README](../README.md) for how this fits into the rest of the project.

## Development

```bash
npm install
npm run dev        # Vite dev server (browser preview, no Tauri APIs)
npm run tauri dev  # full desktop app
```

`npm run tauri dev` needs a Go toolchain on top of the Tauri prerequisites: a
`pretauri` hook compiles `tailnet-sidecar/` into the name Tauri's
`externalBin` expects, which isn't committed. It runs on every Tauri command,
including after a Go change — Tauri would otherwise bundle the stale binary
already in `src-tauri/binaries/` and the change would appear to do nothing.
Cross-building it, for a machine without Go, is covered in
[Self-hosting](../docs/self-hosting.md#the-bundled-go-sidecar).

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
