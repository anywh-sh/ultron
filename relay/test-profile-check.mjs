// Confirma que cada relay roda com o $HOME/cwd isolado certo, olhando o
// evento system/init que o Claude Code manda no começo de cada turno.
import WebSocket from "ws";

const port = process.argv[2];
const label = process.argv[3] ?? `porta ${port}`;
const socket = new WebSocket(`ws://100.64.0.1:${port}`);

socket.on("open", () => {
  socket.send(JSON.stringify({ type: "user_message", text: "responda apenas: OK" }));
});

socket.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "claude_event" && msg.event.type === "system" && msg.event.subtype === "init") {
    console.log(`[${label}] cwd da sessão:`, msg.event.cwd);
  }
  if (msg.type === "turn_complete") {
    process.exit(0);
  }
  if (msg.type === "turn_error") {
    console.error(`[${label}] erro:`, msg.message);
    process.exit(1);
  }
});

setTimeout(() => {
  console.error(`[${label}] timeout`);
  process.exit(1);
}, 30000);
