// View mínima funcional (não é a fase de UI/UX — só validar que as
// funcionalidades do relay aparecem certas: texto, chamada de ferramenta,
// resultado de ferramenta, estado de conexão).
import { RelayClient, type ClaudeContentBlock, type ClaudeEvent } from "./relayClient";
import { listInputDevices, startRecording, stopRecordingAndTranscribe } from "./voice";
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
  const micSelect = document.createElement("select");
  micSelect.id = "chat-mic-select";
  const micButton = document.createElement("button");
  micButton.type = "button";
  micButton.id = "chat-mic";
  micButton.textContent = "🎤";
  const sendButton = document.createElement("button");
  sendButton.type = "submit";
  sendButton.textContent = "Enviar";
  form.append(input, micSelect, micButton, sendButton);

  root.append(log, status, form);

  const MIC_STORAGE_KEY = "ultron:selected-mic";
  void listInputDevices()
    .then((devices) => {
      for (const name of devices) {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        micSelect.appendChild(option);
      }
      if (devices.length === 0) {
        const option = document.createElement("option");
        option.textContent = "nenhum microfone encontrado";
        micSelect.appendChild(option);
        micSelect.disabled = true;
        micButton.disabled = true;
        return;
      }
      const saved = localStorage.getItem(MIC_STORAGE_KEY);
      if (saved && devices.includes(saved)) {
        micSelect.value = saved;
      }
    })
    .catch((error: unknown) => {
      console.error("[ultron] falha ao listar microfones", error);
    });
  micSelect.addEventListener("change", () => {
    localStorage.setItem(MIC_STORAGE_KEY, micSelect.value);
  });

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

  let isRecording = false;
  micButton.addEventListener("click", () => {
    void (async () => {
      if (!isRecording) {
        try {
          const deviceName = micSelect.value || undefined;
          await startRecording(deviceName);
          isRecording = true;
          micButton.textContent = "⏹️";
          status.textContent = "gravando…";
        } catch (error) {
          window.alert(`Não foi possível iniciar a gravação: ${error instanceof Error ? error.message : String(error)}`);
        }
        return;
      }

      isRecording = false;
      micButton.textContent = "🎤";
      status.textContent = "transcrevendo…";
      try {
        const transcribed = await stopRecordingAndTranscribe();
        input.value = input.value ? `${input.value} ${transcribed}` : transcribed;
        status.textContent = "";
        input.focus();
      } catch (error) {
        status.textContent = "";
        window.alert(`Falha na transcrição: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
  });
}
