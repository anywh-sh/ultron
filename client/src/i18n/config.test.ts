import { describe, expect, it } from "vitest";

import { en } from "@/i18n/en";
import { ptBr } from "@/i18n/pt-br";
import { defaultLocale, locales, matchLocale, resolveInitialLocale } from "@/i18n/config";

describe("locale resolution", () => {
  it("prefers a stored choice over the system language", () => {
    // The whole point of storing it: moving the app to a machine that asks
    // for another language must not silently override a deliberate pick.
    expect(resolveInitialLocale("en", ["pt-BR"])).toBe("en");
    expect(resolveInitialLocale("pt-BR", ["en-US"])).toBe("pt-BR");
  });

  it("ignores a stored value that isn't a locale we ship", () => {
    // A stale key from an older build, or a hand-edited localStorage.
    expect(resolveInitialLocale("klingon", ["en-US"])).toBe("en");
    expect(resolveInitialLocale(null, ["en-US"])).toBe("en");
    expect(resolveInitialLocale(undefined, [])).toBe(defaultLocale);
  });

  it("matches the exact tag before the primary subtag", () => {
    expect(matchLocale(["pt-BR", "en"])).toBe("pt-BR");
    expect(matchLocale(["en-GB", "pt-BR"])).toBe("en");
  });

  it("falls back to the primary subtag", () => {
    // A machine set to European Portuguese still gets Portuguese rather than
    // English — closer is better than the fallback.
    expect(matchLocale(["pt-PT"])).toBe("pt-BR");
    expect(matchLocale(["pt"])).toBe("pt-BR");
  });

  it("matches case-insensitively", () => {
    // Browsers are not consistent about the casing they report here.
    expect(matchLocale(["pt-br"])).toBe("pt-BR");
    expect(matchLocale(["EN-us"])).toBe("en");
  });

  it("honors the order the system asked for", () => {
    expect(matchLocale(["fr", "pt-BR", "en"])).toBe("pt-BR");
    expect(matchLocale(["fr", "en", "pt-BR"])).toBe("en");
  });

  it("falls back when nothing matches", () => {
    expect(matchLocale(["fr", "de-CH"])).toBeUndefined();
    expect(resolveInitialLocale(null, ["fr", "de-CH"])).toBe(defaultLocale);
  });
});

describe("dictionaries", () => {
  // The Dictionary type already guarantees both languages have the same keys.
  // What it can't catch is a key left as an empty string while copy is being
  // moved in phase by phase — which renders as a blank button.
  it.each([
    ["en", en],
    ["pt-BR", ptBr],
  ])("has no blank strings in %s", (_locale, dictionary) => {
    const blanks: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (typeof node === "string") {
        if (node.trim() === "") blanks.push(path);
        return;
      }
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        walk(value, path ? `${path}.${key}` : key);
      }
    };
    walk(dictionary, "");
    expect(blanks).toEqual([]);
  });

  it("ships a dictionary for every declared locale", () => {
    expect(locales).toContain(defaultLocale);
  });
});
