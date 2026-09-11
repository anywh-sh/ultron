import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyFontScale,
  DEFAULT_FONT_SCALE,
  MAX_FONT_SCALE,
  MIN_FONT_SCALE,
  readFontScale,
  subscribeFontScale,
  writeFontScale,
} from "./fontScale";

// Real code path throughout — writeFontScale is the production function,
// not a stand-in. Reset both the in-memory module state (writeFontScale
// itself, since the module only re-reads localStorage once at import time)
// and localStorage, same reasoning as profiles.test.ts.
beforeEach(() => {
  writeFontScale(DEFAULT_FONT_SCALE);
  localStorage.clear();
});

describe("writeFontScale", () => {
  it("clamps above the maximum instead of accepting an unreadable page-wide scale", () => {
    writeFontScale(MAX_FONT_SCALE + 50);
    expect(readFontScale()).toBe(MAX_FONT_SCALE);
  });

  it("clamps below the minimum instead of accepting an unreadably tiny app", () => {
    writeFontScale(MIN_FONT_SCALE - 50);
    expect(readFontScale()).toBe(MIN_FONT_SCALE);
  });

  it("persists the clamped value for the next cold start", () => {
    writeFontScale(130);
    expect(localStorage.getItem("anywh:font-scale")).toBe("130");
  });

  it("notifies subscribers on a real change", () => {
    const listener = vi.fn();
    subscribeFontScale(listener);
    writeFontScale(120);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("skips the notification for a no-op write", () => {
    const listener = vi.fn();
    subscribeFontScale(listener);
    writeFontScale(DEFAULT_FONT_SCALE);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("applyFontScale", () => {
  it("scales the root element's font-size proportionally to 16px", () => {
    applyFontScale(150);
    expect(document.documentElement.style.fontSize).toBe("24px");
  });
});
