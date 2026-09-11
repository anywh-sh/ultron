const STORAGE_KEY = "anywh:font-scale";
const BASE_FONT_SIZE_PX = 16;

export const MIN_FONT_SCALE = 80;
export const MAX_FONT_SCALE = 150;
export const FONT_SCALE_STEP = 10;
export const DEFAULT_FONT_SCALE = 100;

function clamp(value: number): number {
  return Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, value));
}

function readStoredScale(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FONT_SCALE;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clamp(parsed) : DEFAULT_FONT_SCALE;
  } catch {
    return DEFAULT_FONT_SCALE;
  }
}

/**
 * Every Tailwind text utility (`text-sm`, `text-xs`, ...) resolves in `rem`,
 * so scaling the root element's `font-size` is what makes the whole app
 * follow a single knob instead of having to touch each component. Device-
 * local only — unlike theme, this never goes through a profile's relay, so
 * there's nothing to sync and no per-profile override.
 */
export function applyFontScale(scale: number): void {
  document.documentElement.style.fontSize = `${(BASE_FONT_SIZE_PX * scale) / 100}px`;
}

let scale = readStoredScale();
const listeners = new Set<() => void>();

export function readFontScale(): number {
  return scale;
}

export function writeFontScale(next: number): void {
  const clamped = clamp(next);
  if (clamped === scale) return;
  scale = clamped;
  localStorage.setItem(STORAGE_KEY, String(clamped));
  applyFontScale(clamped);
  for (const listener of listeners) listener();
}

export function subscribeFontScale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
