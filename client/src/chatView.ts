// View mínima funcional (não é a fase de UI/UX — só validar que as
// funcionalidades do relay aparecem certas: texto, chamada de ferramenta,
// resultado de ferramenta, estado de conexão).
import { RelayClient, type ClaudeContentBlock, type ClaudeEvent } from "./relayClient";
import type { Profile } from "./profiles";

function renderContentBlock(block: ClaudeContentBlock, log: HTMLElement): void {
  if (block.type === "text" && typeof block.text === "string") {
    const el = document.createElement("p");
    el.className = "msg msg-assistant";
    el.textContent = block.text;
    log.appendChild(el);
  } else if (block.type === "tool_use") {
    const el = document.createElement("div");
    el.className = "msg msg-tool-call";
    const command = typeof block.input?.command === "string" ? block.input.command : undefined;
    const description = typeof block.input?.description === "string" ? block.input.description : undefined;
    el.textContent = `🔧 ${block.name ?? "tool"}${description ? ` — ${description}` : ""}${command ? `\n${command}` : ""}`;
    log.appendChild(el);
  } else if (block.type === "tool_result") {
    const el = document.createElement("pre");
    el.className = block.is_error ? "msg msg-tool-result msg-tool-result-error" : "msg msg-tool-result";
    el.textContent = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
    log.appendChild(el);
  }
  // "thinking" e outros tipos de bloco: ignorados por enquanto.
}

export function mountChatView(root: HTMLElement, profile: Profile, sessionName: string): void {
  const log = document.createElement("div");
  log.id = "chat-log";

  const status = document.createElement("div");
  status.id = "chat-status";
  status.textContent = "conectando…";

  const form = document.createElement("form");
  form.id = "chat-form";
  const input = document.createElement("textarea");
  input.id = "chat-input";
  input.placeholder = "Escreva uma mensagem…";
  input.rows = 2;
  const sendButton = document.createElement("button");
  sendButton.type = "submit";
  sendButton.textContent = "Enviar";
  form.append(input, sendButton);

  root.append(log, status, form);

  const client = new RelayClient(profile.host, profile.relayPort, sessionName, {
    onEvent: (event: ClaudeEvent) => {
      if ((event.type === "assistant" || event.type === "user") && event.message?.content) {
        for (const block of event.message.content) {
          renderContentBlock(block, log);
        }
        log.scrollTop = log.scrollHeight;
      } else if (event.type === "system" && event.subtype === "status") {
        status.textContent = event.status ?? "";
      }
    },
    onTurnComplete: () => {
      status.textContent = "";
      sendButton.disabled = false;
    },
    onTurnError: (message: string) => {
      const el = document.createElement("p");
      el.className = "msg msg-error";
      el.textContent = `Erro: ${message}`;
      log.appendChild(el);
      log.scrollTop = log.scrollHeight;

      status.textContent = "";
      sendButton.disabled = false;
    },
    onConnectionChange: (connected: boolean) => {
      status.textContent = connected ? "" : "desconectado";
    },
  });
  client.connect();

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    const userEl = document.createElement("p");
    userEl.className = "msg msg-user";
    userEl.textContent = text;
    log.appendChild(userEl);
    log.scrollTop = log.scrollHeight;

    client.sendMessage(text);
    input.value = "";
    sendButton.disabled = true;
    status.textContent = "pensando…";
  });
}
