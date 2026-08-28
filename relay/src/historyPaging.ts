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
