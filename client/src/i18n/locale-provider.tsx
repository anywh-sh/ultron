import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { defaultLocale, LOCALE_STORAGE_KEY, resolveInitialLocale, type Locale } from "./config";
import { getDictionary } from "./dictionaries";
import type { Dictionary } from "./dictionary";

interface LocaleContextValue {
  locale: Locale;
  dict: Dictionary;
  setLocale: (locale: Locale) => void;
}

/**
 * Defaults to English instead of throwing when there's no provider, so any
 * component can be rendered standalone in a unit test without the whole app
 * shell around it — the same call the account dashboard makes.
 */
const LocaleContext = createContext<LocaleContextValue>({
  locale: defaultLocale,
  dict: getDictionary(defaultLocale),
  setLocale: () => {},
});

function readStoredLocale(): string | null {
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    // Private mode / disabled storage: fall through to the system language.
    return null;
  }
}

function systemLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  // `languages` is the ordered preference list; `language` is the single top
  // choice and the only one some WebViews expose.
  return navigator.languages ?? (navigator.language ? [navigator.language] : []);
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  // Resolved during the first render, never in an effect afterwards: picking
  // the language a tick late would paint the whole interface in the fallback
  // and then swap every string on screen.
  const [locale, setLocaleState] = useState<Locale>(() => resolveInitialLocale(readStoredLocale(), systemLanguages()));

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // Not worth failing a language switch over — it just won't be
      // remembered across restarts.
    }
  }, []);

  // Drives hyphenation, the webview's spellchecker and screen-reader
  // pronunciation. `index.html` ships the fallback so the very first frame
  // isn't mislabeled; this keeps it truthful from then on.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // Memoized because this provider wraps the entire app: an unmemoized object
  // would hand every consumer a new identity on each render of the tree above
  // it. As written, the value only changes when the language actually
  // changes, which is a rare, deliberate action.
  const value = useMemo<LocaleContextValue>(
    () => ({ locale, dict: getDictionary(locale), setLocale }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** The strings. What a component wants in almost every case. */
export function useDict(): Dictionary {
  return useContext(LocaleContext).dict;
}

/** The current locale plus the setter — for the language picker and for
 * anything that has to format a date or a number against it. */
export function useLocale(): { locale: Locale; setLocale: (locale: Locale) => void } {
  const { locale, setLocale } = useContext(LocaleContext);
  return { locale, setLocale };
}
