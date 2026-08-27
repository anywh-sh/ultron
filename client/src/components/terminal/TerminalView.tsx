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
/** Debounce do `resize` mandado pro relay (não do `fit()` local, que
 * continua imediato pra não travar visualmente) — arrastar a borda do
 * painel dispara o ResizeObserver a cada pixel, e cada resize de verdade no
 * pty força o tmux a redesenhar a tela inteira; sem isso, arrastar a borda
 * vira uma enxurrada de redesenhos completos, visivelmente lento. */
const RESIZE_SEND_DEBOUNCE_MS = 100;

function isTerminalMessage(value: unknown): value is { type: "data"; data: string } | { type: "exit"; code: number | null } {
  return typeof value === "object" && value !== null && "type" in value;
}

/**
 * Um xterm.js + uma conexão WS por aba de terminal. Efeito único que possui
 * o ciclo de vida inteiro (instância do xterm, socket, observers) — padrão
 * recomendado pra integrar uma lib imperativa baseada em canvas/DOM próprio
 * com React, mesmo espírito de `ChatPanel`+`useRelayClient`, só que aqui não
 * dá pra separar conexão de exibição: o xterm precisa de um nó DOM real pra
 * se anexar.
 *
 * Desmonta (troca de sessão de chat, aba de terminal fechada, painel
 * fechado) fecha a conexão — o relay só detacha do tmux (ver
 * terminalSession.ts), então remontar reconecta e a tela reaparece do jeito
 * que estava, sem precisar de nenhum buffer de scrollback do lado do
 * cliente.
 */
export function TerminalView({ profile, chatSessionId, terminalId }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new XTerm({
      fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace",
      fontSize: 13,
      lineHeight: 1.35,
      cursorBlink: true,
      // Limitado (não "infinito") de propósito — uso diário com várias abas
      // de terminal em várias sessões não pode acumular memória sem limite
      // por causa de um `npm run dev` esquecido rodando havia horas.
      scrollback: 5000,
      allowProposedApi: true,
      theme: {
        // Transparente de propósito, não `--bg-sidebar` fixo — o canvas do
        // xterm deixa o fundo de verdade do painel (definido uma vez só em
        // `SessionPanel.tsx`) aparecer por trás, em vez de duplicar a cor
        // aqui e arriscar as duas desencontrarem se o tema mudar depois. O
        // `.xterm-viewport` do pacote também força fundo preto sólido no CSS
        // dele (ver override em index.css) — sem os dois, um dos dois ainda
        // ficaria opaco por cima do painel.
        background: "transparent",
        foreground: "#f0eee6",
        cursor: "#d97757",
        cursorAccent: "#262624",
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
    try {
      // Renderer WebGL custa bem menos CPU que o canvas padrão pra output
      // pesado (ex: `npm install`, `cat` de arquivo grande) — importante com
      // várias abas de terminal abertas ao mesmo tempo. Cai pro renderer
      // padrão de graça (`loadAddon` só não é chamado) se o WebView não
      // suportar WebGL2, sem quebrar o terminal.
      term.loadAddon(new WebglAddon());
    } catch (error) {
      console.warn("[ultron] WebGL indisponível pro terminal, usando renderer padrão:", error);
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
