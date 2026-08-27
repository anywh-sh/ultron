import { execFile } from "node:child_process";
import * as pty from "node-pty";
import type { IPty } from "node-pty";
import { buildChildEnv } from "./claudeSession.js";

// Terminal embutido (docs/30) — reaproveita a mesma dupla ttyd+tmux já
// validada neste projeto (docs/08), só que sem o ttyd: o relay já é um
// servidor WS persistente, então spawna o tmux direto via node-pty (`sudo`
// dentro do terminal precisa de TTY real pro prompt de senha — um
// child_process sem PTY não serve). tmux é quem garante persistência de
// verdade: fechar a conexão WS só manda SIGHUP no processo local (que tmux
// trata como *detach*, não como matar a sessão — mesmo comportamento de
// fechar um terminal de verdade com tmux dentro), e um restart do relay
// (ex: deploy de código novo) não derruba os shells abertos, porque o
// servidor tmux roda independente do processo do relay. O relay não guarda
// nenhum registro em memória de qual terminal está vivo — tmux é a fonte de
// verdade, consultado sob demanda (list-sessions) quando precisa.
const TMUX_BIN = process.env.TMUX_BIN ?? "/usr/bin/tmux";

/** Um socket tmux dedicado por instância de relay (== por perfil, já que
 * cada perfil roda seu próprio processo de relay numa porta própria) — sem
 * isso, os dois perfis (pessoal/trabalho, mesmo usuário Unix) colidiriam no
 * socket default do tmux (`/tmp/tmux-<uid>/default`), que não sabe nada de
 * `HOME` override. */
function tmuxSocketName(relayPort: number): string {
  return `ultron-term-${relayPort}`;
}

/** IDs vêm de fora (query string da conexão WS) — nunca interpolados numa
 * shell (tanto `pty.spawn` quanto `execFile` recebem argv como array, não
 * uma string pra shell parsear), mas `:`/`.` têm significado especial na
 * sintaxe de "target" do tmux (session:window.pane) mesmo fora de shell
 * nenhuma, então saneia por garantia mesmo os IDs sendo UUIDs na prática. */
function sanitizeId(id: string): string {
  return id.replace(/[:.]/g, "_");
}

function tmuxSessionName(chatSessionId: string, terminalId: string): string {
  return `${sanitizeId(chatSessionId)}__${sanitizeId(terminalId)}`;
}

export interface SpawnTerminalOptions {
  homeOverride?: string;
  relayPort: number;
  chatSessionId: string;
  terminalId: string;
  cwd: string;
  cols: number;
  rows: number;
}

/** Spawna (ou reanexa a, via `-A`) a sessão tmux dessa aba de terminal. `-c`
 * só tem efeito na criação — reanexar a uma sessão existente ignora `cwd`
 * de propósito (é o comportamento normal de terminal: a pasta de um shell
 * já rodando não teleporta se a working directory da conversa mudar depois;
 * quem quiser outra pasta dá `cd` à mão ou abre uma aba nova).
 *
 * `-f /dev/null` é essencial, não cosmético: socket isolado (`-L`) só separa
 * *sessões* — o tmux ainda carrega `~/.tmux.conf` de verdade pra QUALQUER
 * servidor novo que sobe, não importa o socket. Sem `-f /dev/null`, um
 * `mouse on` (ou qualquer outra coisa) na config pessoal do usuário vazava
 * pro terminal embutido — foi o que causava o indicador `[0/0]` de copy-mode
 * do tmux aparecendo ao selecionar texto com o mouse (achado testando).
 *
 * `; set-option ...` encadeado (token `;` literal — sem shell no meio,
 * `pty.spawn` recebe argv puro, então não é sintaxe de shell, é o próprio
 * tmux reconhecendo `;` como separador de comando) fixa o comportamento que
 * a gente quer, sem depender de config nenhuma: `status off` (senão aparece
 * uma linha de "lixo" com id da sessão truncado + hostname + hora, chrome do
 * tmux duplicando a tira de abas do app) e `mouse off` explícito (já é o
 * default do tmux sem config, mas fica documentado — é o que garante seleção
 * de texto sempre nativa do xterm.js, nunca copy-mode do tmux). `-g` (global,
 * não por sessão) garante que isso vale tanto criando quanto reanexando: um
 * `-t <nome>` explícito só teria efeito na criação, igual `-c` acima. */
export function spawnTerminal(options: SpawnTerminalOptions): IPty {
  const socket = tmuxSocketName(options.relayPort);
  const name = tmuxSessionName(options.chatSessionId, options.terminalId);

  return pty.spawn(
    TMUX_BIN,
    [
      "-L",
      socket,
      "-f",
      "/dev/null",
      "new-session",
      "-A",
      "-s",
      name,
      "-c",
      options.cwd,
      ";",
      "set-option",
      "-g",
      "status",
      "off",
      ";",
      "set-option",
      "-g",
      "mouse",
      "off",
    ],
    {
      name: "xterm-256color",
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: buildChildEnv(options.homeOverride) as Record<string, string>,
    },
  );
}

function execTmux(relayPort: number, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(TMUX_BIN, ["-L", tmuxSocketName(relayPort), ...args], (error, stdout) => {
      // Erros aqui são esperados e sem gravidade (sessão já não existia, ou
      // o socket tmux nunca chegou a existir porque nenhum terminal foi
      // aberto ainda nesse perfil) — nunca vira exceção pro chamador.
      resolve(error ? "" : stdout);
    });
  });
}

/** Fecha uma aba de terminal específica de verdade (mata a sessão tmux, não
 * só detacha) — chamado quando o usuário clica no X de uma aba, diferente
 * de trocar de sessão de chat ou fechar o painel (que só detacham, ver
 * comentário no topo do arquivo). */
export function killTerminal(relayPort: number, chatSessionId: string, terminalId: string): Promise<void> {
  return execTmux(relayPort, ["kill-session", "-t", tmuxSessionName(chatSessionId, terminalId)]).then(() => undefined);
}

/** Varredura por prefixo (não depende de nenhum registro em memória do
 * relay) — chamado ao excluir uma sessão de chat inteira, pra não deixar
 * shells órfãos rodando pra sempre sem nenhuma aba que os controle. */
export async function killAllTerminalsForSession(relayPort: number, chatSessionId: string): Promise<void> {
  const stdout = await execTmux(relayPort, ["list-sessions", "-F", "#{session_name}"]);
  const prefix = `${sanitizeId(chatSessionId)}__`;
  const names = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((name) => name.startsWith(prefix));
  await Promise.all(names.map((name) => execTmux(relayPort, ["kill-session", "-t", name])));
}
