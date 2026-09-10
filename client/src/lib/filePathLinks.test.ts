import { describe, expect, it, vi } from "vitest";
import type { Profile } from "@/lib/profiles";

vi.mock("@/lib/filesClient", () => ({
  listFiles: vi.fn(),
}));

import { listFiles } from "@/lib/filesClient";
import { looksLikeFilePath, resolveChatPath } from "./filePathLinks";

const profile: Profile = { id: "p1", label: "Perfil", host: "localhost", relayPort: 4317 };

describe("looksLikeFilePath", () => {
  it("accepts a nested relative path", () => {
    expect(looksLikeFilePath("screenshots/PROJ-929/entrance-animation-frames.png")).toBe(true);
  });

  it("accepts an absolute path", () => {
    expect(looksLikeFilePath("/home/user/project/README.md")).toBe(true);
  });

  it("rejects a bare filename with no directory segment — too ambiguous with a generic mention", () => {
    expect(looksLikeFilePath("README.md")).toBe(false);
  });

  it("rejects a directory-looking path (trailing slash) — FileViewer only opens files", () => {
    expect(looksLikeFilePath("screenshots/PROJ-929/")).toBe(false);
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

describe("resolveChatPath", () => {
  it("passes an absolute path through unchanged, without fetching the root", async () => {
    const result = await resolveChatPath(profile, "session-1", "/home/user/project/foo.png", null);
    expect(result).toBe("/home/user/project/foo.png");
    expect(listFiles).not.toHaveBeenCalled();
  });

  it("joins a relative path against a cached root, without fetching", async () => {
    const result = await resolveChatPath(profile, "session-1", "screenshots/foo.png", "/home/user/project");
    expect(result).toBe("/home/user/project/screenshots/foo.png");
    expect(listFiles).not.toHaveBeenCalled();
  });

  it("fetches the root when none is cached", async () => {
    vi.mocked(listFiles).mockResolvedValue({ root: "/home/user/project", path: "/home/user/project", entries: [] });
    const result = await resolveChatPath(profile, "session-1", "screenshots/foo.png", null);
    expect(result).toBe("/home/user/project/screenshots/foo.png");
    expect(listFiles).toHaveBeenCalledWith(profile, "session-1");
  });
});
