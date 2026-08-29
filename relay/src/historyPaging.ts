import type { BroadcastMessage } from "./sharedSession.js";

/** Quantos turnos completos mandar de cara pra um cliente que acabou de
 * conectar (Fase 2 do plano de histórico paginado, docs/30) — chute educado
 * até calibrar contra um caso real grande (ex: "IVT Fix", ~1670 linhas de
 * transcript reconstruídas). O resto vem sob demanda via `load_older_history`
 * quando o usuário rolar pra cima. */
export const INITIAL_HISTORY_TAIL_TURNS = 20;

export interface HistoryPage {
  messages: BroadcastMessage[];
  /** Índice (dentro de `history`) do primeiro evento desta página — é o que
   * o cliente devolve como `beforeCursor` pra pedir a página anterior
   * (mais antiga). */
  cursor: number;
  /** Se `false`, `cursor` é `0` e não existe turno mais antigo que essa
   * página pra buscar. */
  hasMore: boolean;
}

function isTurnBoundary(message: BroadcastMessage): boolean {
  return message.type === "turn_complete" || message.type === "turn_error";
}

/** Índices de início de cada turno dentro de `history`. Um turno vai do seu
 * índice de início até (inclusive) o próximo `turn_complete`/`turn_error` —
 * exceto o último, que fica "aberto" (sem terminador ainda) se houver
 * genuinamente um turno em andamento no momento em que isso roda. Não exige
 * um `user_prompt` marcando o início (histórico ao vivo antes da Fase 1 não
 * tinha isso) — o corte usa só o terminador do fim, presente nos dois casos. */
function turnStartIndices(history: BroadcastMessage[]): number[] {
  if (history.length === 0) return [];
  const starts = [0];
  for (let i = 0; i < history.length; i++) {
    if (isTurnBoundary(history[i]) && i + 1 < history.length) starts.push(i + 1);
  }
  return starts;
}

/**
 * Devolve até `maxTurns` turnos completos imediatamente antes de
 * `beforeCursor` (exclusive). `beforeCursor: history.length` pega a cauda
 * mais recente (uso de `SharedSession.addClient`); o `cursor` devolvido por
 * uma página busca a página seguinte, mais antiga (uso de
 * `SharedSession.loadOlderHistory`) — os dois casos são a mesma função.
 */
export function pageHistoryBefore(history: BroadcastMessage[], beforeCursor: number, maxTurns: number): HistoryPage {
  const starts = turnStartIndices(history).filter((start) => start < beforeCursor);
  if (starts.length === 0) return { messages: [], cursor: 0, hasMore: false };
  const cutoffIndex = Math.max(0, starts.length - maxTurns);
  const cursor = starts[cutoffIndex];
  return { messages: history.slice(cursor, beforeCursor), cursor, hasMore: cutoffIndex > 0 };
}

/** `true` só pro turno de follow-up automático de um job `ultron-bg`
 * terminado (docs/32, Fase D) — nunca aparece pro usuário como mensagem
 * editável (o client renderiza como nota de sistema, `kind:
 * "background-job-note"`, não como bolha `kind: "user"`). Mensagens antigas
 * de antes da Fase 1 de docs/30 (sem `user_prompt` marcando o início do
 * turno) caem no `false` default — tratadas como reais, mesmo comportamento
 * que já existia antes dessa distinção existir. */
function isSyntheticBackgroundJobStart(message: BroadcastMessage): boolean {
  return (
    message.type === "claude_event" && message.event.type === "user_prompt" && message.event.synthetic === "background_job"
  );
}

export interface EditTarget {
  /** Índice em `history` onde o turno editado começa — tudo a partir daqui
   * (inclusive) é descartado. */
  cutIndex: number;
  /** Quantos turnos (reais + sintéticos) precedem esse ponto. Cada turno,
   * real ou sintético, corresponde a exatamente uma chamada `claude -p` e
   * portanto exatamente uma linha `user` no `.jsonl` real — por isso esse
   * número é também o parâmetro que `transcriptFork.ts` precisa pra cortar o
   * arquivo no mesmo lugar, sem precisar reconstruir a distinção
   * real/sintético a partir do disco (docs/33). */
  turnsBefore: number;
}

/**
 * Acha o ponto de corte pra editar a `fromEnd`-ésima mensagem do usuário
 * contando do fim (`1` = a última) — pula turnos sintéticos de `ultron-bg`
 * ao contar, já que eles não aparecem pro usuário como mensagem editável
 * (docs/33). `undefined` se `fromEnd` for maior que a quantidade de turnos
 * reais existentes (pedido inválido/obsoleto — quem chama deve recusar em
 * vez de truncar errado).
 */
export function findEditTarget(history: BroadcastMessage[], fromEnd: number): EditTarget | undefined {
  const starts = turnStartIndices(history);
  let realTurnsSeen = 0;
  for (let k = starts.length - 1; k >= 0; k--) {
    if (isSyntheticBackgroundJobStart(history[starts[k]])) continue;
    realTurnsSeen++;
    if (realTurnsSeen === fromEnd) return { cutIndex: starts[k], turnsBefore: k };
  }
  return undefined;
}
