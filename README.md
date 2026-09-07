# ultron

A thin wrapper around the [Claude Code](https://claude.ai/code) CLI: chat, voice input, image upload, multi-session, and a file browser from a native app on desktop (Windows/macOS, Linux untested — Tauri supports it, but nobody has run it there yet) or iOS — while the actual `claude` process keeps running on a machine you control.

## Why

If you run Claude Code on a headless machine (a home server, a NAS, an always-on desktop) and connect to it over SSH from elsewhere, you lose things the official Claude apps have: voice input, drag-and-drop images, decent mobile formatting. The official apps solve that by moving your session into their own cloud — ultron doesn't. It's a relay that sits between a real client app and the real `claude` binary: the CLI keeps running on your machine, authenticated the same way it already is (OAuth/subscription, not a billed API key), and the app is just a nicer way to talk to it from any device.

## How it works

```
┌─────────────┐        WebSocket        ┌───────────┐      spawns       ┌─────────────┐
│  Client app │ ◄─────────────────────► │   Relay   │ ─────────────────►│  claude CLI │
│ (Tauri: Win/│                         │  (Node,   │                    │ (-p, one    │
│  macOS/iOS) │                         │  systemd  │                    │  process    │
└─────────────┘                         │  or CLI)  │                    │  per turn)  │
                                         └───────────┘                    └─────────────┘
```

- **Relay** (`relay/`): a Node/TypeScript server that spawns `claude -p ...` per turn, streams the JSON events back over WebSocket, and persists session/tab state to disk. No API key ever touches it — `ANTHROPIC_API_KEY` is stripped from the child process's environment on purpose, so usage always counts against your Claude plan, never pay-per-token billing.
- **Client** (`client/`): React + TypeScript + Tailwind + shadcn/ui, packaged with [Tauri 2.0](https://v2.tauri.app/) for desktop and iOS from one codebase.

## Status

Functional MVP, self-hosted and used daily by its author: chat, voice, image upload, multi-session, multi-profile, a terminal panel and a read-only file browser for the session's working directory — validated on Windows, macOS and iOS.

Setting up your own instance means pointing the client at your relay by hand (below) — there's no pairing/QR flow or one-command setup yet.

## Getting started (self-host)

### Relay

```bash
cd relay
npm install
cp .env.example .env   # edit CLAUDE_BIN / EXTRA_PATH_DIRS if `claude` isn't on PATH
npm run build
npm start               # or `npm run dev` during development
```

By default it listens on `127.0.0.1:8765` (`RELAY_HOST`/`RELAY_PORT` in `.env.example`). It needs the `claude` CLI already installed and logged in on the same machine.

**Advanced: running it as a systemd service** (survives reboots/crashes unattended) is documented in [`infra/systemd/README.md`](./infra/systemd/README.md).

### Client

Requires the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS (Rust toolchain + platform-specific system deps).

```bash
cd client
npm install
npm run tauri dev       # desktop app
```

By default the client points at a relay on the same machine (`127.0.0.1:8765`). Until the pairing flow mentioned in [Status](#status) exists, there are two ways to point it at your own relay instead:

- **Build-time env var** — works on both desktop and iOS:
  ```bash
  cd client
  cp .env.example .env   # set VITE_ULTRON_HOST / VITE_ULTRON_PORT
  npm run tauri dev
  ```
- **`localStorage` override** — desktop only (needs DevTools), no rebuild required:
  ```js
  localStorage.setItem("ultron:profiles", JSON.stringify([
    { id: "default", label: "Default", host: "127.0.0.1", relayPort: 8765 },
  ]));
  ```
  then reload.

iOS has no DevTools, so an iOS build today assumes you're building from source with the env var set — see `client/README.md` for iOS-specific commands.

## Security model

The relay has no authentication and CORS is wide open — the threat model is "trusted network" (your LAN, or a personal [Tailscale](https://tailscale.com/)/WireGuard network for remote access), not the public internet. Don't expose the relay's port directly to the internet.

This matters more than "no authentication" alone suggests: the relay's default permission mode is `bypassPermissions` (`--dangerously-skip-permissions`), so anyone who can reach the port can run arbitrary code as you, not just read your conversations.

## Remote access (outside your LAN)

Nothing here is automated — it's network setup you do once, with your own accounts, and ultron never sees it.

1. Create a personal [Tailscale](https://tailscale.com/) account (the free tier covers individual use) and install the client on the relay machine and on every device you want to connect from.
2. On the relay machine, run `tailscale ip -4` to get its tailnet address (a `100.x.y.z`).
3. Point the relay at that interface: set `RELAY_HOST` in `relay/.env` to the tailnet IP, or to `0.0.0.0` to listen everywhere. Read the [Security model](#security-model) before choosing `0.0.0.0`.
4. Point the client at that IP and port — see [Client](#client) above.

**The catch nobody mentions: the relay machine has to stay powered on and awake.** Your session lives on that machine; if it sleeps, the app has nothing to connect to. This is true on your LAN too, but it only becomes obvious once you're away from home.

## A note on `docs/NN` references

Comments across the codebase cite the project's decision history by number (`docs/08`, `docs/23`, ...). That history isn't published — the markers are provenance, not links. The comment around each one carries the actual finding.

## License

[Apache License 2.0](./LICENSE).
