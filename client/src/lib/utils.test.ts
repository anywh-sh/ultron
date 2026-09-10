import { describe, expect, it } from "vitest";
import { truncateWords } from "./utils";

describe("truncateWords", () => {
  it("leaves a text with exactly maxWords untouched", () => {
    const text = Array.from({ length: 12 }, (_, i) => `w${String(i)}`).join(" ");
    expect(truncateWords(text, 12)).toBe(text);
  });

  it("leaves a shorter text untouched", () => {
    expect(truncateWords("uma sessão curta", 12)).toBe("uma sessão curta");
  });

  it("cuts anything past maxWords and appends ...", () => {
    const text = Array.from({ length: 20 }, (_, i) => `w${String(i)}`).join(" ");
    const expectedPrefix = Array.from({ length: 12 }, (_, i) => `w${String(i)}`).join(" ");
    expect(truncateWords(text, 12)).toBe(`${expectedPrefix}...`);
  });
});
