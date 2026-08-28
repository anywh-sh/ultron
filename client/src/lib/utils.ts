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

/** `[Hh] [MMm] SSs` — cronômetro do turno em andamento (TurnIndicator),
 * separado de `formatDuration` porque o formato `mm:ss` lá é convenção de
 * timer de gravação, não de "há quanto tempo o agente está pensando".
 * Unidade mais significativa mostrada nunca tem zero à esquerda (`1m 08s`,
 * não `01m 08s` — só ganha um segundo dígito de verdade quando passa de 9);
 * as de baixo dela continuam preenchidas (`08s`) pro alinhamento. Unidades
 * zeradas à esquerda somem: sem hora nenhuma sem passar de 1h, sem minuto
 * nenhum sem passar de 1m. */
export function formatDurationLong(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, "0")}m ${seconds.toString().padStart(2, "0")}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}
