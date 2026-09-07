/**
 * Small sRGB helpers used to fill in the tokens a custom theme leaves out
 * (themeApply.ts).
 *
 * Why not `color-mix()` in CSS, which the app already uses elsewhere: the
 * derived values also have to reach xterm (TerminalView.tsx), and xterm
 * takes literal colors in a JS object, not CSS. Reading them back with
 * `getComputedStyle` doesn't help either — an unregistered custom property
 * computes to its token stream, so `--bg-sidebar` would come back as the
 * string "color-mix(in srgb, …)" rather than a resolved color. Deriving to
 * literals here keeps one answer for both consumers.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

let probe: HTMLSpanElement | undefined;

/**
 * Resolves any CSS color the theme validator accepts — including `hsl()`
 * and `oklch()`, which aren't worth hand-parsing — by handing it to the
 * engine and reading back the computed `color`, which is always
 * `rgb()`/`rgba()`. The probe stays attached and hidden: a detached element
 * has no computed style in WebKit.
 */
export function parseColor(value: string): Rgba | undefined {
  if (typeof document === "undefined") return undefined;
  if (!probe) {
    probe = document.createElement("span");
    probe.style.display = "none";
    document.documentElement.append(probe);
  }
  // A value the engine rejects leaves the previous one in place, so the
  // reset is what turns "invalid" into a detectable empty string.
  probe.style.color = "";
  probe.style.color = value;
  if (probe.style.color === "") return undefined;

  const computed = getComputedStyle(probe).color;
  const match = /^rgba?\(([^)]+)\)$/.exec(computed);
  if (!match) return undefined;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return undefined;
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 && !Number.isNaN(parts[3]) ? parts[3] : 1 };
}

export function toCss({ r, g, b, a }: Rgba): string {
  const round = (n: number) => Math.round(Math.min(255, Math.max(0, n)));
  return a >= 1
    ? `rgb(${String(round(r))} ${String(round(g))} ${String(round(b))})`
    : `rgb(${String(round(r))} ${String(round(g))} ${String(round(b))} / ${a.toFixed(3)})`;
}

/** `ratio` 0 keeps `a`, 1 becomes `b`. Alpha travels with the mix. */
export function mix(a: Rgba, b: Rgba, ratio: number): Rgba {
  const t = Math.min(1, Math.max(0, ratio));
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: a.a + (b.a - a.a) * t,
  };
}

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

/** Toward black by `percent` — "one step down" in the surface stack. */
export function shade(color: Rgba, percent: number): Rgba {
  return mix(color, BLACK, percent / 100);
}

/** Toward white by `percent` — "one step up" in the surface stack. */
export function tint(color: Rgba, percent: number): Rgba {
  return mix(color, WHITE, percent / 100);
}

/**
 * Perceived brightness (ITU-R BT.601), 0–255. Used to pick a direction
 * (lighten vs darken) without trusting the theme's declared `appearance`,
 * which an author can get wrong — a "light" theme with a near-black
 * background would otherwise derive a set of surfaces nobody can read.
 */
export function luminance({ r, g, b }: Rgba): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
