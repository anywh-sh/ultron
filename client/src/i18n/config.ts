/**
 * Locale set and how one gets chosen. Deliberately free of any i18n library:
 * the dictionary is a plain typed object (see dictionary.ts), so a lookup is
 * a property access with no runtime cost, and the bundle carries no
 * translation engine. Mirrors the account dashboard's approach, which faced
 * the same choice.
 */
export const locales = ["en", "pt-BR"] as const;

export type Locale = (typeof locales)[number];

/** Fallback whenever the stored preference is absent or unusable and the
 * operating system asks for a language this app doesn't have. English rather
 * than Portuguese to match the marketing site and the account dashboard — the
 * repository is public, and a first-time reader shouldn't land in a language
 * they may not read. */
export const defaultLocale: Locale = "en";

export const LOCALE_STORAGE_KEY = "anywh:locale";

/** Each language is named in itself, never translated — a Brazilian reader
 * scanning a language list looks for "Português", not for "Portuguese". */
export const localeNames: Record<Locale, string> = {
  en: "English",
  "pt-BR": "Português (Brasil)",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && locales.includes(value as Locale);
}

/**
 * First supported locale among the languages the OS asked for, matching an
 * exact tag first (`pt-BR`) and then the primary subtag (`pt`, `pt-PT`).
 * Tag comparison is case-insensitive because the casing browsers report is
 * not guaranteed — `navigator.language` can hand back `pt-br`.
 */
export function matchLocale(preferred: readonly string[]): Locale | undefined {
  const supported = locales.map((locale) => [locale.toLowerCase(), locale] as const);

  for (const tag of preferred) {
    const wanted = tag.toLowerCase();
    const exact = supported.find(([lower]) => lower === wanted);
    if (exact) return exact[1];

    const primary = wanted.split("-")[0];
    const bySubtag = supported.find(([lower]) => lower.split("-")[0] === primary);
    if (bySubtag) return bySubtag[1];
  }
  return undefined;
}

/**
 * A stored preference always wins: once someone picks a language, moving the
 * app to a machine with a different system language must not silently
 * override them.
 */
export function resolveInitialLocale(stored: unknown, preferred: readonly string[]): Locale {
  if (isLocale(stored)) return stored;
  return matchLocale(preferred) ?? defaultLocale;
}
