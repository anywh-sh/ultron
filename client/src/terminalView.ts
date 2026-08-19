import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { TtydClient } from "./ttydClient";
import type { Profile } from "./profiles";

export function mountTerminalView(container: HTMLElement, profile: Profile): void {
  const terminal = new Terminal({
    fontSize: 13,
    fontFamily: "Consolas, Menlo, monospace",
    theme: { background: "#1e1e1e", foreground: "#d4d4d4" },
  });
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(container);
  fitAddon.fit();

  const client = new TtydClient(profile.host, profile.port, {
    onOutput: (data) => terminal.write(data),
    onTitleChange: (title) => {
      document.title = `ultron — ${profile.label} — ${title}`;
    },
    onClose: () => {
      terminal.write("\r\n\r\n[conexão encerrada]\r\n");
    },
  });

  terminal.onData((data) => client.sendInput(data));
  terminal.onResize(({ cols, rows }) => client.sendResize(cols, rows));
  window.addEventListener("resize", () => fitAddon.fit());

  client.connect(terminal.cols, terminal.rows);
  terminal.focus();
}
