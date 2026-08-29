import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { extractHumanText, type TranscriptLine } from "./transcriptReader.js";

/**
 * Edição de mensagem (docs/33) — corta o `.jsonl` que o Claude Code CLI
 * mantém sozinho, no ponto exato da mensagem que o usuário editou, e grava o
 * resultado como uma sessão nova (`session_id` novo). É a única forma real
 * de "recomeçar a conversa a partir daqui": o `claude` CLI não tem nenhuma
 * flag de "retomar cortando no meio" (confirmado no `--help`: só
 * `--resume`/`--fork-session`, sempre a partir da ponta) — sem isso, o
 * próximo `--resume` releria o arquivo inteiro (mensagem antiga + tudo que
 * veio depois) e mandaria esse histórico "errado" pra API, mesmo com a UI já
 * escondendo a mensagem editada.
 *
 * `turnsToKeep` é a contagem de turnos (linhas `user` com texto humano
 * genuíno, mesmo critério de `transcriptReader.ts`) que devem sobreviver ao
 * corte — calculado pelo chamador (`SharedSession`) a partir do `history` em
 * memória, que é quem sabe distinguir um turno sintético de `ultron-bg` de
 * um real (o arquivo em si não marca essa diferença). Como cada turno, real
 * ou sintético, corresponde a exatamente uma chamada `claude -p` e portanto
 * exatamente uma linha no `.jsonl`, contar da mesma forma dos dois lados
 * sempre bate — não precisa reconstruir a distinção real/sintético aqui.
 */
export function forkTruncatedTranscript(path: string, turnsToKeep: number): string {
  const rawLines = readFileSync(path, "utf8").split("\n").filter((line) => line.trim().length > 0);

  let seen = 0;
  let cutAt = rawLines.length;
  for (let i = 0; i < rawLines.length; i++) {
    let line: TranscriptLine;
    try {
      line = JSON.parse(rawLines[i]) as TranscriptLine;
    } catch {
      continue; // mesma tolerância de transcriptReader.ts — só a última linha pode vir quebrada.
    }
    if (line.type !== "user") continue;
    // Só a linha de texto humano genuíno conta como início de turno — mesmo
    // critério de `transcriptReader.ts`. `tool_result` (`isToolResultOnly`)
    // não inicia turno, é feedback do próprio loop agentic.
    const humanText = extractHumanText(line);
    if (humanText === undefined) continue;
    if (seen === turnsToKeep) {
      cutAt = i;
      break;
    }
    seen++;
  }

  const kept = rawLines.slice(0, cutAt);
  const newSessionId = randomUUID();
  const rewritten = kept.map((rawLine) => {
    const parsed = JSON.parse(rawLine) as TranscriptLine;
    parsed.sessionId = newSessionId;
    return JSON.stringify(parsed);
  });

  const newPath = join(dirname(path), `${newSessionId}.jsonl`);
  writeFileSync(newPath, rewritten.length > 0 ? rewritten.join("\n") + "\n" : "");
  return newSessionId;
}
