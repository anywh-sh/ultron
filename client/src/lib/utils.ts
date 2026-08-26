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

/** `MMm SSs` — cronômetro do turno em andamento (TurnIndicator), separado de
 * `formatDuration` porque o formato `mm:ss` lá é convenção de timer de
 * gravação, não de "há quanto tempo o agente está pensando". */
export function formatDurationLong(seconds: number): string {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}m ${s}s`;
}
