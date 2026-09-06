import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** `mm:ss` — used by the voice recording timer (Composer). */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

/** `[Hh] [Mm] Ss` — timer for the turn in progress (TurnIndicator), separate
 * from `formatDuration` because the `mm:ss` format there is a recording
 * timer convention, not "how long has the agent been thinking". Never
 * zero-pads any unit (`1h 1m 5s`, not `1h 01m 05s`) — a second digit only
 * shows up when the value genuinely goes past 9. Leading zeroed units
 * disappear: no hour at all without passing 1h, no minute at all without
 * passing 1m. */
export function formatDurationLong(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
