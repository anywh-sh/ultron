import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyFontSize,
  DEFAULT_FONT_SIZE,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  readFontSize,
  subscribeFontSize,
  writeFontSize,
} from "./fontSize";

// Real code path throughout — writeFontSize is the production function, not
// a stand-in. Reset both the in-memory module state (writeFontSize itself,
// since the module only re-reads localStorage once at import time) and
// localStorage, same reasoning as profiles.test.ts.
beforeEach(() => {
  writeFontSize(DEFAULT_FONT_SIZE);
  localStorage.clear();
  document.documentElement.removeAttribute("style");
});

describe("writeFontSize", () => {
  it("clamps above the maximum instead of accepting an unreadably large app", () => {
    writeFontSize(MAX_FONT_SIZE + 50);
    expect(readFontSize()).toBe(MAX_FONT_SIZE);
  });

  it("clamps below the minimum instead of accepting unreadably tiny text", () => {
    writeFontSize(MIN_FONT_SIZE - 50);
    expect(readFontSize()).toBe(MIN_FONT_SIZE);
  });

  it("persists the clamped value for the next cold start", () => {
    writeFontSize(18);
    expect(localStorage.getItem("anywh:font-size")).toBe("18");
  });

  it("notifies subscribers on a real change", () => {
    const listener = vi.fn();
    subscribeFontSize(listener);
    writeFontSize(16);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("skips the notification for a no-op write", () => {
    const listener = vi.fn();
    subscribeFontSize(listener);
    writeFontSize(DEFAULT_FONT_SIZE);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("applyFontSize", () => {
  it("scales every text-* token proportionally to the requested size, at text-sm", () => {
    applyFontSize(28); // double the default 14px `text-sm`
    const root = document.documentElement.style;
    expect(root.getPropertyValue("--text-sm")).toBe("28px");
    expect(root.getPropertyValue("--text-xs")).toBe("24px");
    expect(root.getPropertyValue("--text-base")).toBe("32px");
    expect(root.getPropertyValue("--text-lg")).toBe("36px");
  });

  it("never touches spacing or the root font-size — only text tokens move", () => {
    applyFontSize(20);
    expect(document.documentElement.style.fontSize).toBe("");
  });
});
