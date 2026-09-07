import { DEFAULT_THEME } from "@/lib/builtinThemes";
import { luminance, mix, parseColor, shade, tint, toCss, type Rgba } from "@/lib/color";
import {
  OPTIONAL_COLOR_KEYS,
  TERMINAL_COLOR_KEYS,
  type Theme,
  type ThemeAppearance,
  type ThemeColorKey,
  type TerminalColorKey,
} from "@/lib/theme";

/** Every token the app reads, with no gaps — what actually gets written to
 * the root element. */
export type ResolvedColors = Record<ThemeColorKey, string>;

export interface ResolvedTheme {
  id: string;
  appearance: ThemeAppearance;
  colors: ResolvedColors;
  terminal: Record<TerminalColorKey, string>;
}

/**
 * A theme only has to declare six colors (see REQUIRED_COLOR_KEYS), so
 * everything else is derived here rather than demanded from the author.
 *
 * The direction of each derivation comes from the background's brightness,
 * not from the theme's declared `appearance`: a mislabeled theme would
 * otherwise get a surface stack running the wrong way (elevated surfaces
 * darker than the background on a light theme), which is unreadable rather
 * than merely wrong. `appearance` stays what the author declared — it's how
 * the theme is labeled and grouped in the UI.
 */
function isDarkBackground(background: Rgba | undefined): boolean {
  return background ? luminance(background) < 128 : true;
}

function derivedColors(theme: Theme): ResolvedColors {
  const declared = theme.colors;
  const resolved: Record<string, string> = { ...declared };

  const background = parseColor(declared.background);
  const mutedForeground = parseColor(declared["muted-foreground"]);
  const border = parseColor(declared.border);
  const dark = isDarkBackground(background);

  // Falls back to the built-in value whenever a required color couldn't be
  // parsed. The validator makes that nearly impossible, but "nearly" isn't
  // a reason to emit `undefined` into a CSS custom property.
  const fallback = (key: ThemeColorKey): string => DEFAULT_THEME.colors[key] ?? "";
  const put = (key: ThemeColorKey, value: Rgba | string | undefined): void => {
    if (resolved[key] !== undefined) return;
    resolved[key] = typeof value === "string" ? value : value ? toCss(value) : fallback(key);
  };
  // Surface stack. The sidebar is the one surface *below* the background in
  // both directions; everything else climbs above it. On a light theme the
  // climb is toward white and has to move much further per step before it
  // reads as a different surface at all, hence the two sets of amounts.
  const step = (darkAmount: number, lightAmount: number): Rgba | undefined => {
    if (!background) return undefined;
    return dark ? tint(background, darkAmount) : tint(background, lightAmount);
  };
  put("bg-sidebar", background ? shade(background, dark ? 18 : 4) : undefined);
  put("bg-elevated", step(3, 45));
  put("card", step(5, 70));
  put("bubble-user", background ? (dark ? tint(background, 8) : shade(background, 3)) : undefined);

  put("text-faint", mutedForeground && background ? mix(mutedForeground, background, 0.45) : undefined);
  put("border-soft", border && background ? mix(border, background, 0.55) : undefined);

  // No sane derivation from a UI palette: the warning tone and the "added
  // line" green are their own hues by construction (see index.css), so an
  // undeclared one keeps the built-in rather than getting invented.
  put("context-ring-warn", fallback("context-ring-warn"));
  put("diff-add", fallback("diff-add"));

  put("overlay", dark ? "rgb(0 0 0 / 0.5)" : "rgb(0 0 0 / 0.35)");
  put("glass-tint", declared.foreground);
  put("media-scrim", fallback("media-scrim"));
  put("media-scrim-foreground", fallback("media-scrim-foreground"));
  put("shadow-color", dark ? "rgb(0 0 0 / 0.65)" : "rgb(0 0 0 / 0.25)");

  put("syntax-comment", resolved["text-faint"]);
  put("syntax-keyword", declared.primary);
  put("syntax-string", dark ? fallback("syntax-string") : "#4f7a3a");
  put("syntax-number", dark ? fallback("syntax-number") : "#3f6486");
  put("syntax-title", declared.foreground);

  // Profile dots are the app's own identity colors, not the theme's: they
  // have to stay distinguishable from each other across every theme, and
  // deriving six distinct hues from one palette isn't something to guess.
  for (const key of ["profile-1", "profile-2", "profile-3", "profile-4", "profile-5", "profile-6"] as const) {
    put(key, fallback(key));
  }

  for (const key of OPTIONAL_COLOR_KEYS) {
    if (resolved[key] === undefined) resolved[key] = fallback(key);
  }
  return resolved as ResolvedColors;
}

/**
 * Terminal palette. xterm needs literal colors, so this never emits a CSS
 * expression. An undeclared `terminal` block keeps the built-in ANSI 16 but
 * still adopts the theme's own surface/foreground/cursor — a custom theme
 * without a terminal palette should at least not have a terminal painted a
 * different color than the panel around it.
 */
function derivedTerminal(colors: ResolvedColors, declared: Theme["terminal"]): Record<TerminalColorKey, string> {
  const primary = parseColor(colors.primary);
  const result: Record<string, string> = {
    ...DEFAULT_THEME.terminal,
    background: colors["bg-sidebar"],
    foreground: colors.foreground,
    cursor: colors.primary,
    cursorAccent: colors["bg-sidebar"],
    selectionBackground: primary ? toCss({ ...primary, a: 0.35 }) : DEFAULT_THEME.terminal?.selectionBackground ?? "",
    ...declared,
  };
  for (const key of TERMINAL_COLOR_KEYS) {
    result[key] ??= DEFAULT_THEME.terminal?.[key] ?? "";
  }
  return result as Record<TerminalColorKey, string>;
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  const colors = derivedColors(theme);
  return {
    id: theme.id,
    appearance: theme.appearance,
    colors,
    terminal: derivedTerminal(colors, theme.terminal),
  };
}

/**
 * Writes the theme onto the root element. Every token is always written —
 * never a partial update — so switching themes can't leave a token behind
 * from the previous one.
 */
function paint(appearance: ThemeAppearance, colors: ResolvedColors): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(colors)) {
    root.style.setProperty(`--${key}`, value);
  }
  // Drives the `dark:` variant (see @custom-variant in index.css) and the
  // native controls' color scheme.
  root.dataset.appearance = appearance;
  root.style.colorScheme = appearance;
}

export function applyResolvedTheme(resolved: ResolvedTheme): void {
  paint(resolved.appearance, resolved.colors);
}

export function applyTheme(theme: Theme): ResolvedTheme {
  const resolved = resolveTheme(theme);
  applyResolvedTheme(resolved);
  return resolved;
}

// --- Boot cache -----------------------------------------------------------
//
// The theme a profile uses lives on the relay (profiles.json), so on a cold
// start it isn't known until a sync completes — the app would paint in the
// built-in theme, mount, sync, and repaint, every single launch. Caching the
// resolved tokens locally lets the first paint already be right.

const CACHE_KEY = "ultron:theme-cache";
/** Owned by `useActiveProfile` — read (never written) here, to know which
 * profile's cached theme to paint before React decides anything. */
const LAST_PROFILE_KEY = "ultron:last-profile";

type ThemeCache = Record<string, { appearance: ThemeAppearance; colors: ResolvedColors }>;

function readCache(): ThemeCache {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return typeof parsed === "object" && parsed !== null ? (parsed as ThemeCache) : {};
  } catch {
    return {};
  }
}

export function cacheResolvedTheme(profileId: string, resolved: ResolvedTheme): void {
  const cache = readCache();
  cache[profileId] = { appearance: resolved.appearance, colors: resolved.colors };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // A full quota isn't worth failing a theme switch over — the app just
    // goes back to repainting once per cold start.
  }
}

export function forgetCachedTheme(profileId: string): void {
  const cache = readCache();
  if (cache[profileId] === undefined) return;
  delete cache[profileId];
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

/**
 * Called from `main.tsx` before the first render. Deliberately duplicates
 * how `useActiveProfile` picks the initial profile (query override, then
 * last used) instead of importing it: this runs before any store is read,
 * and getting it wrong only costs one repaint once React takes over.
 */
export function applyCachedTheme(): void {
  const override = new URLSearchParams(window.location.search).get("profile");
  const profileId = override ?? localStorage.getItem(LAST_PROFILE_KEY);
  if (!profileId) return;
  const entry = readCache()[profileId];
  if (!entry) return;
  paint(entry.appearance, entry.colors);
}
