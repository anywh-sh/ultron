import type { Locale } from "./config";
import type { Dictionary } from "./dictionary";
import { en } from "./en";
import { ptBr } from "./pt-br";

/**
 * Separate from `index.ts` on purpose. The barrel re-exports the provider,
 * and the provider needs a dictionary at module scope (the default context
 * value) — importing that from the barrel makes a cycle in which the provider
 * evaluates first and reads this map before it is initialized. It failed
 * exactly that way, as a `Cannot access 'dictionaries' before initialization`
 * in every test that mounts the app.
 */
const dictionaries: Record<Locale, Dictionary> = {
  en,
  "pt-BR": ptBr,
};

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
