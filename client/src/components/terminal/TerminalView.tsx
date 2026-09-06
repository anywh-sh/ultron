import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import type { Profile } from "@/lib/profiles";

interface TerminalViewProps {
  profile: Profile;
  chatSessionId: string;
  terminalId: string;
}

const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 30_000;
/** Debounce for the `resize` sent to the relay (not for the local `fit()`,
 * which stays immediate so it doesn't visually stutter) — dragging the
 * panel's edge fires the ResizeObserver on every pixel, and every real
 * resize on the pty forces tmux to redraw the whole screen; without this,
 * dragging the edge turns into a flood of full redraws, visibly slow. */
const RESIZE_SEND_DEBOUNCE_MS = 100;

function isTerminalMessage(value: unknown): value is { type: "data"; data: string } | { type: "exit"; code: number | null } {
  return typeof value === "object" && value !== null && "type" in value;
}

/**
 * One xterm.js + one WS connection per terminal tab. Single effect that
 * owns the whole lifecycle (xterm instance, socket, observers) — the
 * recommended pattern for integrating an imperative canvas/own-DOM-based
 * library with React, same spirit as `ChatPanel`+`useRelayClient`, except
 * here connection can't be separated from display: xterm needs a real DOM
 * node to attach to.
 *
 * Unmounting (chat session switch, terminal tab closed, panel closed)
 * closes the connection — the relay only detaches from tmux (see
 * terminalSession.ts), so remounting reconnects and the screen reappears
 * the way it was, with no need for any client-side scrollback buffer.
 */
export function TerminalView({ profile, chatSessionId, terminalId }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // A previous attempt used `theme.background: "transparent"` +
    // `allowTransparency` to let the panel's background (`SessionPanel`,
    // `--bg-sidebar`) show through behind the canvas — in practice a
    // visibly different dark rectangle still remained (tested in the real
    // app). Simpler and more robust: instead of chasing real transparency
    // through 2D canvas + WebGL addon + the package's own CSS, paint the
    // terminal with the SAME solid color as the panel — read straight from
    // `--bg-sidebar` (not hardcoded here) so it never drifts out of sync if
    // the theme changes. Bonus: without `allowTransparency`, the canvases
    // go back to not needing an alpha channel, slightly cheaper to composite.
    const bgSidebar = getComputedStyle(document.documentElement).getPropertyValue("--bg-sidebar").trim() || "#1f1e1c";

    const term = new XTerm({
      fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace",
      fontSize: 13,
      lineHeight: 1.35,
      cursorBlink: true,
      // Limited (not "infinite") on purpose — daily use with several
      // terminal tabs across several sessions can't accumulate memory
      // without bound just because of a forgotten `npm run dev` that's been
      // running for hours.
      scrollback: 5000,
      allowProposedApi: true,
      theme: {
        background: bgSidebar,
        foreground: "#f0eee6",
        cursor: "#d97757",
        cursorAccent: bgSidebar,
        selectionBackground: "rgba(217, 119, 87, 0.35)",
        black: "#1f1e1c",
        red: "#c06456",
        green: "#9cae7c",
        yellow: "#d9a441",
        blue: "#7c93ab",
        magenta: "#b48ead",
        cyan: "#8fbcbb",
        white: "#f0eee6",
        brightBlack: "#6f6a5f",
        brightRed: "#d98282",
        brightGreen: "#b3c69a",
        brightYellow: "#e6bb63",
        brightBlue: "#9db3c9",
        brightMagenta: "#c9b6d4",
        brightCyan: "#a8d3d1",
        brightWhite: "#ffffff",
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    // Plain Ctrl+V: by default xterm treats Ctrl+<letter> as a control
    // character for the shell (here, 0x16 — readline/vim's "quoted insert")
    // and cancels the native keydown — on Chromium/WebView2 this suppresses
    // the default paste action, so the `paste` event never fires
    // (Ctrl+Shift+V already works, doesn't go through this path; Cmd+V on
    // macOS doesn't either, it uses `metaKey`, not `ctrlKey`). Returning
    // `false` here makes xterm ignore this specific keydown and let the
    // browser's native paste happen normally.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type === "keydown" && event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "v") {
        return false;
      }
      return true;
    });
    try {
      // WebGL renderer costs much less CPU than the default canvas one for
      // heavy output (e.g. `npm install`, `cat` of a big file) — important
      // with several terminal tabs open at the same time. Falls back to the
      // default renderer for free (`loadAddon` simply isn't called) if the
      // WebView doesn't support WebGL2, without breaking the terminal.
      term.loadAddon(new WebglAddon());
    } catch (error) {
      console.warn("[ultron] WebGL unavailable for terminal, falling back to default renderer:", error);
    }
    fitAddon.fit();

    let socket: WebSocket | undefined;
    let shouldReconnect = true;
    let reconnectAttempt = 0;
    let reconnectTimer: number | undefined;
    let resizeSendTimer: number | undefined;

    function connect(): void {
      const params = new URLSearchParams({
        session: chatSessionId,
        term: terminalId,
        cols: String(term.cols),
        rows: String(term.rows),
      });
      const ws = new WebSocket(`ws://${profile.host}:${profile.relayPort}/terminal?${params.toString()}`);
      socket = ws;

      ws.addEventListener("open", () => {
        reconnectAttempt = 0;
        setReconnecting(false);
      });
      ws.addEventListener("message", (event) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data as string);
        } catch {
          return;
        }
        if (!isTerminalMessage(parsed)) return;
        if (parsed.type === "data") {
          term.write(parsed.data);
        } else if (parsed.type === "exit") {
          term.write(`\r\n\x1b[90m[processo encerrado]\x1b[0m\r\n`);
        }
      });
      ws.addEventListener("close", () => {
        if (socket !== ws) return;
        if (!shouldReconnect) return;
        setReconnecting(true);
        const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempt, RECONNECT_MAX_DELAY_MS);
        reconnectAttempt += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      });
    }
    connect();

    const inputDisposable = term.onData((data) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "input", data }));
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      window.clearTimeout(resizeSendTimer);
      resizeSendTimer = window.setTimeout(() => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      }, RESIZE_SEND_DEBOUNCE_MS);
    });
    resizeObserver.observe(container);

    return () => {
      shouldReconnect = false;
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(resizeSendTimer);
      resizeObserver.disconnect();
      inputDisposable.dispose();
      socket?.close();
      term.dispose();
    };
  }, [profile.host, profile.relayPort, chatSessionId, terminalId]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full p-2" />
      {reconnecting && (
        <div className="absolute top-2 right-2 rounded-md bg-bg-elevated px-2 py-0.5 text-xs text-muted-foreground">
          Reconectando…
        </div>
      )}
    </div>
  );
}
