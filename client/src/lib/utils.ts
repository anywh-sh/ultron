import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** `mm:ss` — usado pelo timer de gravação de voz (Composer). */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

/** `[Hh] [Mm] Ss` — cronômetro do turno em andamento (TurnIndicator),
 * separado de `formatDuration` porque o formato `mm:ss` lá é convenção de
 * timer de gravação, não de "há quanto tempo o agente está pensando". Nunca
 * preenche com zero à esquerda em nenhuma unidade (`1h 1m 5s`, não
 * `1h 01m 05s`) — um segundo dígito só aparece quando o valor passa de 9 de
 * verdade. Unidades zeradas à esquerda somem: sem hora nenhuma sem passar de
 * 1h, sem minuto nenhum sem passar de 1m. */
export function formatDurationLong(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
