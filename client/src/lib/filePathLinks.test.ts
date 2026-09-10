import { describe, expect, it } from "vitest";
import { looksLikeFilePath } from "./filePathLinks";

describe("looksLikeFilePath", () => {
  it("accepts a nested relative path", () => {
    expect(looksLikeFilePath("screenshots/PROJ-929/entrance-animation-frames.png")).toBe(true);
  });

  it("accepts an absolute path", () => {
    expect(looksLikeFilePath("/home/user/project/README.md")).toBe(true);
  });

  it("accepts a directory (trailing slash) — resolution decides whether it exists", () => {
    expect(looksLikeFilePath("screenshots/PROJ-929/")).toBe(true);
  });

  it("rejects a bare `/`", () => {
    expect(looksLikeFilePath("/")).toBe(false);
  });

  it("accepts a bare filename with a plausible extension", () => {
    expect(looksLikeFilePath("App.tsx")).toBe(true);
    expect(looksLikeFilePath("README.md")).toBe(true);
  });

  it("rejects a bare word with no extension — too ambiguous with a generic mention", () => {
    expect(looksLikeFilePath("Dockerfile")).toBe(false);
    expect(looksLikeFilePath("relay")).toBe(false);
  });

  it("rejects a version string or decimal — the extension-like suffix starts with a digit", () => {
    expect(looksLikeFilePath("v1.2")).toBe(false);
    expect(looksLikeFilePath("3.14")).toBe(false);
  });

  it("rejects a URL — already handled by MarkdownContent's `a` override", () => {
    expect(looksLikeFilePath("https://example.com/foo/bar")).toBe(false);
  });

  it("rejects text with a space — not a single path token", () => {
    expect(looksLikeFilePath("see screenshots/foo.png")).toBe(false);
  });

  it("rejects text with leading/trailing whitespace", () => {
    expect(looksLikeFilePath(" screenshots/foo.png ")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(looksLikeFilePath("")).toBe(false);
  });
});
