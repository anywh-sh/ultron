// Theme file format and its validator. Duplicated verbatim from
// relay/src/theme.ts — the two sides need the exact same answer about
// whether a theme file is broken, and there's no shared package in this repo
// (same call as planChoiceMarker.ts, which is duplicated for the same
// reason). Keep them in sync; this copy carries no extra logic.
//
// The client validates so it can show a specific error before any round
// trip; the relay validates again because it writes the file to disk and
// can't trust a body just because some client said it was fine.
//
// The validation messages are in Portuguese because they're rendered
// verbatim in the import UI (the relay's copy travels back in the HTTP
// error body and lands in the same list) — they're UI text, not log text.

export const THEME_VERSION = 1;

export type ThemeAppearance = "dark" | "light";

/** Ids that a custom theme can never take: they're the built-in themes
 * (client/src/lib/builtinThemes.ts), which don't live on disk at all, so a
 * custom file under one of these names would be permanently shadowed. */
export const RESERVED_THEME_IDS = ["default", "papel"];

/**
 * Without these six, there's no theme — a file missing `background` or
 * `foreground` isn't a partial theme, it's an unusable one. Everything else
 * is optional and falls back to the built-in of the same `appearance`, so a
 * short theme file is a legitimate way to write one.
 */
export const REQUIRED_COLOR_KEYS = [
  "background",
  "foreground",
  "muted-foreground",
  "primary",
  "destructive",
  "border",
] as const;

/**
 * Every key here maps 1:1 to the CSS custom property of the same name
 * (`background` -> `--background`), which is what makes applying a theme a
 * plain loop over the entries (client/src/lib/themeApply.ts) instead of a
 * translation table. Keep in sync with the `:root` block in
 * client/src/index.css — a token that exists there but not here can't be
 * themed, and one that exists here but not there does nothing.
 */
export const OPTIONAL_COLOR_KEYS = [
  "bg-sidebar",
  "bg-chrome",
  "bg-elevated",
  "surface-hover",
  "card",
  "bubble-user",
  "text-faint",
  "primary-soft",
  "primary-ink",
  "border-soft",
  "context-ring-warn",
  "diff-add",
  "overlay",
  "glass-tint",
  "media-scrim",
  "media-scrim-foreground",
  "shadow-color",
  "syntax-comment",
  "syntax-keyword",
  "syntax-string",
  "syntax-number",
  "syntax-title",
  "profile-1",
  "profile-2",
  "profile-3",
  "profile-4",
  "profile-5",
  "profile-6",
] as const;

export type RequiredColorKey = (typeof REQUIRED_COLOR_KEYS)[number];
export type OptionalColorKey = (typeof OPTIONAL_COLOR_KEYS)[number];
export type ThemeColorKey = RequiredColorKey | OptionalColorKey;

/**
 * xterm's own option names, not kebab-case CSS names like `colors` above:
 * these never become CSS custom properties (xterm takes literal colors in a
 * JS object, TerminalView.tsx), and anyone writing a terminal palette
 * already knows this vocabulary from every other terminal theme.
 */
export const TERMINAL_COLOR_KEYS = [
  "background",
  "foreground",
  "cursor",
  "cursorAccent",
  "selectionBackground",
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

export type TerminalColorKey = (typeof TERMINAL_COLOR_KEYS)[number];

export interface Theme {
  version: typeof THEME_VERSION;
  id: string;
  name: string;
  appearance: ThemeAppearance;
  colors: Record<RequiredColorKey, string> & Partial<Record<OptionalColorKey, string>>;
  terminal?: Partial<Record<TerminalColorKey, string>>;
  /** Written by the relay on save, never by the author — last-write-wins
   * marker for the same theme edited from two devices. */
  updatedAt?: string;
}

export interface ThemeValidationError {
  /** Dotted path into the file (`colors.background`), so the UI can point
   * at the offending line instead of saying "invalid theme". */
  path: string;
  message: string;
}

export type ThemeValidation =
  | { ok: true; theme: Theme }
  | { ok: false; errors: ThemeValidationError[] };

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const MAX_ID_LENGTH = 32;
const MAX_NAME_LENGTH = 48;

/**
 * A color value ends up in a CSS custom property, so "any string" is not a
 * safe default. The CSSOM already drops values it can't parse, but plenty
 * of *parseable* values are still wrong to accept here: `url(https://…)` in
 * a background token turns opening a theme someone sent you into an
 * outbound request that leaks your IP, and `var(…)` lets a theme reference
 * (or cycle through) the app's own tokens. Whitelisting the formats is the
 * only version of this check that's actually a check.
 *
 * No nested parens in the function form on purpose — that's what keeps
 * `rgb(var(--x))` and friends out.
 */
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTIONAL_COLOR = /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(\s*[0-9a-z.%,/\s+-]*\)$/i;
const MAX_COLOR_LENGTH = 64;

export function isValidColorValue(value: string): boolean {
  if (value.length === 0 || value.length > MAX_COLOR_LENGTH) return false;
  const trimmed = value.trim();
  if (trimmed === "transparent") return true;
  return HEX_COLOR.test(trimmed) || FUNCTIONAL_COLOR.test(trimmed);
}

export function isValidThemeId(id: string): boolean {
  return id.length > 0 && id.length <= MAX_ID_LENGTH && ID_PATTERN.test(id);
}

function validateColorMap(
  raw: unknown,
  path: string,
  allowedKeys: readonly string[],
  errors: ThemeValidationError[],
): Record<string, string> {
  const result: Record<string, string> = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    errors.push({ path, message: "esperava um objeto de cores" });
    return result;
  }
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowedKeys.includes(key)) {
      // Rejected, not ignored: a typo'd token that silently does nothing is
      // exactly the "my theme file is broken and I can't tell why" case
      // this validator exists to catch.
      errors.push({ path: `${path}.${key}`, message: "token desconhecido" });
      continue;
    }
    if (typeof value !== "string" || !isValidColorValue(value)) {
      errors.push({
        path: `${path}.${key}`,
        message: "cor inválida — use hex (#rrggbb), rgb()/hsl()/oklch() ou transparent",
      });
      continue;
    }
    result[key] = value.trim();
  }
  return result;
}

/**
 * Parses and validates a theme file. Collects every problem instead of
 * failing on the first one — someone hand-writing a theme should see the
 * whole list in one pass, not fix six typos in six round trips.
 */
export function parseTheme(input: unknown): ThemeValidation {
  const errors: ThemeValidationError[] = [];

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: [{ path: "", message: "esperava um objeto JSON" }] };
  }
  const raw = input as Record<string, unknown>;

  if (raw.version !== THEME_VERSION) {
    errors.push({ path: "version", message: `esperava ${String(THEME_VERSION)}` });
  }

  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!isValidThemeId(id)) {
    errors.push({
      path: "id",
      message: "id inválido — minúsculas, números e hífen, até 32 caracteres",
    });
  } else if (RESERVED_THEME_IDS.includes(id)) {
    errors.push({ path: "id", message: `"${id}" é um id reservado de tema embutido` });
  }

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    errors.push({ path: "name", message: `nome obrigatório, até ${String(MAX_NAME_LENGTH)} caracteres` });
  }

  const appearance = raw.appearance;
  if (appearance !== "dark" && appearance !== "light") {
    errors.push({ path: "appearance", message: 'esperava "dark" ou "light"' });
  }

  const allColorKeys: readonly string[] = [...REQUIRED_COLOR_KEYS, ...OPTIONAL_COLOR_KEYS];
  const colors = validateColorMap(raw.colors, "colors", allColorKeys, errors);
  // Only keys that aren't in the file at all. A required key that IS there
  // but holds an invalid color already produced its own, more specific
  // error — listing it again as "missing" reads like two separate problems.
  const declaredKeys = typeof raw.colors === "object" && raw.colors !== null ? Object.keys(raw.colors) : [];
  const missing = REQUIRED_COLOR_KEYS.filter((key) => !declaredKeys.includes(key));
  if (missing.length > 0) {
    errors.push({ path: "colors", message: `faltando: ${missing.join(", ")}` });
  }

  let terminal: Record<string, string> | undefined;
  if (raw.terminal !== undefined) {
    terminal = validateColorMap(raw.terminal, "terminal", TERMINAL_COLOR_KEYS, errors);
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    theme: {
      version: THEME_VERSION,
      id,
      name,
      appearance: appearance as ThemeAppearance,
      colors: colors as Theme["colors"],
      ...(terminal && Object.keys(terminal).length > 0 ? { terminal } : {}),
      ...(typeof raw.updatedAt === "string" ? { updatedAt: raw.updatedAt } : {}),
    },
  };
}

/** One line per problem, for a `console.error` or a compact UI list. */
export function formatThemeErrors(errors: ThemeValidationError[]): string {
  return errors.map((error) => (error.path ? `${error.path}: ${error.message}` : error.message)).join("\n");
}
