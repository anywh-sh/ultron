// Cliente de teste manual do relay — conecta, manda 2 turnos, confirma que
// o session_id se mantém entre eles (continuidade de contexto de verdade).
// Rodar do diretório `relay/`, com o relay já no ar (`npm run dev`):
// `node scripts/manual/test-client.mjs`.
import WebSocket from "ws";

const socket = new WebSocket("ws://127.0.0.1:8765");

function send(text) {
  socket.send(JSON.stringify({ type: "user_message", text }));
}

let turn = 0;
const resultsSeen = [];

socket.on("open", () => {
  console.log("[test] connected, sending turn 1");
  turn = 1;
  send("Minha cor favorita e verde-anywh. So confirme que anotou, nao repita ela.");
});

socket.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "claude_event") {
    const event = msg.event;
    if (event.type === "result") {
      resultsSeen.push(event);
      console.log(`[test] turn ${turn} result:`, event.result);
      console.log(`[test] turn ${turn} session_id:`, event.session_id);
    }
  } else if (msg.type === "turn_complete") {
    console.log(`[test] turn ${turn} complete`);
    if (turn === 1) {
      turn = 2;
      console.log("[test] sending turn 2 (testing continuity through the relay)");
      send("Qual e minha cor favorita?");
    } else {
      console.log("--- resultado final ---");
      console.log("turnos completados:", resultsSeen.length);
      console.log(
        "session_id manteve entre turnos:",
        resultsSeen[0]?.session_id === resultsSeen[1]?.session_id,
      );
      socket.close();
      process.exit(0);
    }
  }
});

socket.on("error", (err) => {
  console.error("[test] error:", err.message);
  process.exit(1);
});

setTimeout(() => {
  console.error("[test] timeout — algo travou");
  process.exit(1);
}, 60000);
