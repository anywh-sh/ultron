import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { detectDefaultModel } from "./defaultModel.js";
import { listDirectories } from "./fsBrowse.js";
import { defaultCwd } from "./paths.js";
import { SessionManager } from "./sessionManager.js";
import { SessionStore, type ModelChoice, type PermissionMode } from "./sessionStore.js";
import { killAllTerminalsForSession, killTerminal, spawnTerminal } from "./terminalSession.js";
import { saveUpload } from "./uploads.js";

// Config via env — permite rodar uma instância por perfil (systemd,
// infra/systemd/) sem mudar código, igual o ttyd fazia (docs/08).
const PORT = Number(process.env.RELAY_PORT ?? 8765);
const HOST = process.env.RELAY_HOST ?? "127.0.0.1";
const HOME_OVERRIDE = process.env.RELAY_HOME_OVERRIDE;
const DEFAULT_SESSION = "default";

// Mesmo padrão do RELAY_UPLOAD_DIR: os dois serviços systemd (pessoal/
// trabalho) compartilham WorkingDirectory, então um caminho relativo fixo
// colidiria entre perfis — precisa de env var dedicada em produção. O
// fallback "./sessions.local.json" é só pra `npm run dev` local.
const SESSIONS_FILE = process.env.RELAY_SESSIONS_FILE ?? "./sessions.local.json";

interface UserMessage {
  type: "user_message";
  text: string;
}

function isUserMessage(value: unknown): value is UserMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "user_message" &&
    typeof (value as { text?: unknown }).text === "string"
  );
}

function isStopTurnMessage(value: unknown): value is { type: "stop_turn" } {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "stop_turn";
}

function isClearConversationMessage(value: unknown): value is { type: "clear_conversation" } {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "clear_conversation";
}

function isSetCwdMessage(value: unknown): value is { type: "set_cwd"; path: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "set_cwd" &&
    typeof (value as { path?: unknown }).path === "string"
  );
}

const PERMISSION_MODES: readonly PermissionMode[] = ["default", "acceptEdits", "plan", "bypassPermissions"];

function isSetPermissionModeMessage(value: unknown): value is { type: "set_permission_mode"; mode: PermissionMode } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "set_permission_mode" &&
    PERMISSION_MODES.includes((value as { mode?: unknown }).mode as PermissionMode)
  );
}

const MODEL_CHOICES: readonly ModelChoice[] = ["default", "sonnet", "opus", "haiku", "fable"];

function isSetModelMessage(value: unknown): value is { type: "set_model"; model: ModelChoice } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "set_model" &&
    MODEL_CHOICES.includes((value as { model?: unknown }).model as ModelChoice)
  );
}

function isRenameBody(value: unknown): value is { id: string; title: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { title?: unknown }).title === "string"
  );
}

function isIdBody(value: unknown): value is { id: string } {
  return typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string";
}

function isTerminalCloseBody(value: unknown): value is { session: string; term: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { session?: unknown }).session === "string" &&
    typeof (value as { term?: unknown }).term === "string"
  );
}

function isTerminalInputMessage(value: unknown): value is { type: "input"; data: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "input" &&
    typeof (value as { data?: unknown }).data === "string"
  );
}

function isTerminalResizeMessage(value: unknown): value is { type: "resize"; cols: number; rows: number } {
  if (typeof value !== "object" || value === null || (value as { type?: unknown }).type !== "resize") return false;
  const cols = (value as { cols?: unknown }).cols;
  const rows = (value as { rows?: unknown }).rows;
  return typeof cols === "number" && cols > 0 && typeof rows === "number" && rows > 0;
}

/** Sem lib de parsing de body no projeto (só o upload binário tinha um
 * acumulador de chunks, `uploads.ts`) — o corpo de rename é pequeno o
 * bastante (um id + um título) pra não justificar trazer uma dependência só
 * por isso. */
function readJsonBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    req.on("error", reject);
  });
}

const sessionStore = new SessionStore(SESSIONS_FILE, defaultCwd(HOME_OVERRIDE));
const sessionManager = new SessionManager(HOME_OVERRIDE, sessionStore);

// `true` a partir do primeiro SIGTERM/SIGINT recebido — rejeita turno novo
// (ver `isUserMessage` acima) enquanto `gracefulShutdown` espera os turnos
// já em andamento terminarem, ver definição no fim do arquivo.
let shuttingDown = false;

// Sondagem do modelo padrão da conta desse perfil (docs/28) — roda uma vez
// no boot, em paralelo com tudo o mais (não bloqueia `httpServer.listen`
// abaixo). `defaultModelClients` cobre a corrida óbvia: a conexão WS do
// primeiro cliente quase sempre chega antes da sondagem resolver.
let defaultModelLabel: string | undefined;
const defaultModelClients = new Set<WebSocket>();
detectDefaultModel(HOME_OVERRIDE, defaultCwd(HOME_OVERRIDE))
  .then((label) => {
    defaultModelLabel = label;
    if (!label) return;
    for (const client of defaultModelClients) {
      client.send(JSON.stringify({ type: "default_model_state", label }));
    }
  })
  .catch((error: unknown) => {
    console.error("[relay] falha ao detectar modelo padrão:", error);
  });

const httpServer = createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/sessions")) {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.end(JSON.stringify({ sessions: sessionManager.listTitled() }));
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/sessions/rename")) {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    readJsonBody(req)
      .then((body) => {
        const title = isRenameBody(body) ? body.title.trim() : "";
        if (!isRenameBody(body) || !title) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "id e title (não vazio) são obrigatórios" }));
          return;
        }
        const ok = sessionManager.renameTitle(body.id, title);
        if (!ok) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: "sessão não encontrada" }));
          return;
        }
        res.end(JSON.stringify({ ok: true }));
      })
      .catch(() => {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "corpo inválido" }));
      });
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/sessions/delete")) {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    readJsonBody(req)
      .then((body) => {
        if (!isIdBody(body)) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "id é obrigatório" }));
          return;
        }
        const ok = sessionManager.deleteSession(body.id);
        if (!ok) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: "sessão não encontrada" }));
          return;
        }
        // Varre e mata qualquer terminal (tmux) que essa sessão de chat
        // ainda tivesse aberto — sem isso ficaria órfão pra sempre, sem
        // nenhuma aba na UI que soubesse que ele existe (ver terminalSession.ts).
        killAllTerminalsForSession(PORT, body.id)
          .catch((error: unknown) => console.error("[relay] falha ao limpar terminais da sessão excluída:", error))
          .finally(() => res.end(JSON.stringify({ ok: true })));
      })
      .catch(() => {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "corpo inválido" }));
      });
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/terminals/close")) {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    readJsonBody(req)
      .then((body) => {
        if (!isTerminalCloseBody(body)) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "session e term são obrigatórios" }));
          return;
        }
        killTerminal(PORT, body.session, body.term)
          .then(() => res.end(JSON.stringify({ ok: true })))
          .catch((error: unknown) => {
            console.error("[relay] falha ao fechar terminal:", error);
            res.writeHead(500);
            res.end(JSON.stringify({ error: "falha ao fechar terminal" }));
          });
      })
      .catch(() => {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "corpo inválido" }));
      });
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/fs/list")) {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const requestedPath = url.searchParams.get("path");
    const result = listDirectories(requestedPath ?? defaultCwd(HOME_OVERRIDE));
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (!result.ok) {
      const status = result.error === "permission_denied" ? 403 : result.error === "not_found" ? 404 : 400;
      res.writeHead(status);
      res.end(JSON.stringify({ error: result.error }));
      return;
    }
    res.end(JSON.stringify({ path: result.path, entries: result.entries }));
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/upload")) {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const ext = url.searchParams.get("ext") ?? "bin";
    saveUpload(req, ext)
      .then((path) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.end(JSON.stringify({ path }));
      })
      .catch((error: unknown) => {
        console.error("[relay] falha no upload:", error);
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.writeHead(500);
        res.end(String(error instanceof Error ? error.message : error));
      });
    return;
  }

  res.writeHead(426);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });

httpServer.listen(PORT, HOST, () => {
  console.log(`[relay] listening on ws://${HOST}:${PORT}`, HOME_OVERRIDE ? `(HOME=${HOME_OVERRIDE})` : "");
});

/** Um shell interativo (tmux) por aba de terminal — protocolo próprio,
 * bem mais simples que o do chat (sem replay de histórico: reanexar ao tmux
 * já redesenha a tela sozinho, ver terminalSession.ts). Fechar a conexão WS
 * (troca de aba/sessão, painel fechado, ou rede caindo) só detacha — nunca
 * mata a sessão tmux por aqui; matar de verdade é só via `POST
 * /terminals/close` (aba fechada explicitamente) ou na exclusão da sessão
 * de chat inteira. */
function handleTerminalConnection(socket: WebSocket, url: URL): void {
  const chatSessionId = url.searchParams.get("session")?.trim() || DEFAULT_SESSION;
  const terminalId = url.searchParams.get("term")?.trim();
  if (!terminalId) {
    socket.close();
    return;
  }
  const cols = Number(url.searchParams.get("cols"));
  const rows = Number(url.searchParams.get("rows"));

  const cwd = sessionStore.getCwdState(chatSessionId).cwd;
  const term = spawnTerminal({
    homeOverride: HOME_OVERRIDE,
    relayPort: PORT,
    chatSessionId,
    terminalId,
    cwd,
    cols: Number.isFinite(cols) && cols > 0 ? Math.floor(cols) : 80,
    rows: Number.isFinite(rows) && rows > 0 ? Math.floor(rows) : 24,
  });

  const dataSub = term.onData((data) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: "data", data }));
  });
  const exitSub = term.onExit(({ exitCode }) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: "exit", code: exitCode }));
  });

  socket.on("message", (raw: Buffer) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return;
    }
    try {
      if (isTerminalInputMessage(parsed)) {
        term.write(parsed.data);
      } else if (isTerminalResizeMessage(parsed)) {
        term.resize(Math.floor(parsed.cols), Math.floor(parsed.rows));
      }
    } catch (error) {
      // `term.write`/`term.resize` chamam ioctl no fd do pty por baixo —
      // achado rodando o app de verdade: uma mensagem em trânsito (ex:
      // resize debounced) pode chegar depois do pty já ter morrido (`close`
      // do socket já rodou `term.kill()`, ou o processo saiu sozinho),
      // lançando uma exceção síncrona (`EBADF`). Sem este try/catch isso
      // não ficava só nessa aba de terminal — derrubava o processo do relay
      // INTEIRO (exceção não tratada dentro do handler de um EventEmitter),
      // junto com toda sessão de chat conectada nele. Descartar a mensagem
      // é seguro: o cliente do terminal já vai reconectar sozinho se o pty
      // de fato morreu.
      console.error("[relay] mensagem de terminal descartada, pty possivelmente já morto:", error);
    }
  });

  socket.on("close", () => {
    dataSub.dispose();
    exitSub.dispose();
    term.kill();
  });
}

wss.on("connection", (socket: WebSocket, request) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (url.pathname === "/terminal") {
    handleTerminalConnection(socket, url);
    return;
  }

  const sessionId = url.searchParams.get("session")?.trim() || DEFAULT_SESSION;

  console.log(`[relay] client connected (session: ${sessionId})`);
  const session = sessionManager.getOrCreate(sessionId);
  session.addClient(socket);

  defaultModelClients.add(socket);
  if (defaultModelLabel) socket.send(JSON.stringify({ type: "default_model_state", label: defaultModelLabel }));

  socket.on("message", (raw: Buffer) => {
    const parsed: unknown = JSON.parse(raw.toString());
    if (isStopTurnMessage(parsed)) {
      session.stopTurn();
      return;
    }
    if (isClearConversationMessage(parsed)) {
      session.clearConversation();
      return;
    }
    if (isSetCwdMessage(parsed)) {
      const result = session.setCwd(parsed.path);
      if (!result.ok) socket.send(JSON.stringify({ type: "set_cwd_error", message: result.error }));
      return;
    }
    if (isSetPermissionModeMessage(parsed)) {
      session.setPermissionMode(parsed.mode);
      return;
    }
    if (isSetModelMessage(parsed)) {
      session.setModel(parsed.model);
      return;
    }
    if (!isUserMessage(parsed)) {
      console.warn("[relay] mensagem ignorada, formato inesperado:", parsed);
      return;
    }
    if (shuttingDown) {
      socket.send(JSON.stringify({ type: "turn_error", message: "relay reiniciando, tente de novo em instantes" }));
      return;
    }
    session.submitTurn(socket, parsed.text);
  });

  socket.on("close", () => {
    session.removeClient(socket);
    defaultModelClients.delete(socket);
    console.log(`[relay] client disconnected (session: ${sessionId})`);
  });
});

// Quanto tempo esperar turno(s) em andamento terminarem sozinhos antes de
// desistir e abortar via SIGINT (ver abaixo) — generoso de propósito
// (respostas longas existem), mas configurável pra não exigir rebuild se
// precisar ajustar. O unit systemd (`TimeoutStopSec`) precisa ficar MAIOR
// que isso + `SHUTDOWN_ABORT_GRACE_MS`, senão o systemd manda SIGKILL pro
// cgroup inteiro antes da gente sequer terminar de esperar.
const SHUTDOWN_GRACE_MS = Number(process.env.RELAY_SHUTDOWN_GRACE_MS ?? 4 * 60 * 1000);
// Depois do SIGINT de fallback (mesmo caminho do botão "Parar" — testado
// contra o binário, sai limpo com `result` válido), quanto esperar o
// processo `claude -p` de fato terminar antes de sair de qualquer jeito.
const SHUTDOWN_ABORT_GRACE_MS = 10_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * SIGTERM (`systemctl restart`/`stop`) ou SIGINT (Ctrl+C em dev) — por
 * padrão o systemd (`KillMode=control-group`, não usado aqui de propósito,
 * ver infra/systemd/) mandaria o sinal pro processo `claude -p` filho ao
 * mesmo tempo que pro relay, matando um turno em andamento cru (só o SIGINT
 * mandado pelo botão "Parar" foi validado como saída limpa, não SIGTERM).
 * Com `KillMode=mixed` no unit, só o relay recebe o sinal — esta função para
 * de aceitar conexão nova e turno novo, espera os turnos já em andamento
 * terminarem sozinhos, e só recorre ao SIGINT (`stopTurn`, mesmo caminho do
 * botão "Parar") se algum ficar preso além do prazo de graça.
 */
async function gracefulShutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[relay] ${signal} recebido — parando de aceitar conexão nova e esperando turno(s) em andamento...`);
  httpServer.close();

  const idle = sessionManager.waitForAllIdle();
  const timedOut = await Promise.race([idle.then(() => false), delay(SHUTDOWN_GRACE_MS).then(() => true)]);

  if (timedOut) {
    console.warn(
      `[relay] turno(s) ainda em andamento após ${SHUTDOWN_GRACE_MS}ms — abortando com SIGINT (mesmo caminho do botão "Parar") antes de sair.`,
    );
    sessionManager.stopAllTurns();
    await Promise.race([idle, delay(SHUTDOWN_ABORT_GRACE_MS)]);
  }

  console.log("[relay] saindo.");
  process.exit(0);
}

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
