import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { WheelEvent } from "react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Cuts `text` down to its first `maxWords` words, appending `...` if
 * anything was cut. Word-count truncation, not CSS's char/pixel-based
 * `truncate` — for text where the natural bound is "how much someone can
 * read at a glance" rather than a fixed box width (TabBar's tab tooltip: the
 * tab itself already truncates by width, but the tooltip exists specifically
 * to show the rest of a long title, and an unbounded one could still run
 * arbitrarily long for a pathological title). */
export function truncateWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  return words.length <= maxWords ? text : `${words.slice(0, maxWords).join(" ")}...`;
}

/** Redirects vertical wheel input to horizontal scroll — for tab strips that
 * only ever scroll on the x-axis (TabBar, PaneTabStrip), where a plain mouse
 * wheel would otherwise do nothing (no vertical overflow to catch it) and
 * let the scroll fall through to whatever's behind the strip. Trackpad
 * horizontal swipes already arrive as `deltaX` and are left alone. */
export function scrollHorizontallyOnWheel(event: WheelEvent<HTMLElement>): void {
  if (event.deltaY === 0) return;
  event.currentTarget.scrollLeft += event.deltaY;
  event.preventDefault();
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
