import { StrictMode } from "react";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentMock = vi.fn(async (): Promise<string[]> => [
  "anywh://import-profile/?label=test&joinCode=ABC123&claimUrl=https%3A%2F%2Fexample.test%2Fclaim&brokerUrl=https%3A%2F%2Fexample.test%2Fconnect%2Fw1",
]);
const onOpenUrlMock = vi.fn((_handler: (urls: string[]) => void) => Promise.resolve(() => {}));
vi.mock("@tauri-apps/plugin-deep-link", () => ({
  getCurrent: () => getCurrentMock(),
  onOpenUrl: (handler: (urls: string[]) => void) => onOpenUrlMock(handler),
}));
vi.mock("@/lib/tauri", () => ({ inTauri: () => true }));

const importProfileMock = vi.fn(async (_params: unknown): Promise<string> => "new-profile-id");
vi.mock("@/lib/profileImport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/profileImport")>();
  return { ...actual, importProfile: (params: unknown) => importProfileMock(params) };
});

import { useProfileImport } from "@/hooks/useProfileImport";

beforeEach(() => {
  vi.useFakeTimers();
  getCurrentMock.mockClear();
  importProfileMock.mockClear();
  onOpenUrlMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useProfileImport", () => {
  it("redeems a cold-launch join code exactly once under StrictMode's mount/cleanup/mount replay", async () => {
    const onImported = vi.fn();
    renderHook(() => { useProfileImport(onImported); }, { wrapper: StrictMode });

    await vi.runAllTimersAsync();

    // Both StrictMode mounts call getCurrent() (it's cheap, side-effect-free
    // on the native side) — what must happen exactly once is the actual
    // redemption of the single-use join code.
    expect(importProfileMock).toHaveBeenCalledTimes(1);
    expect(onImported).toHaveBeenCalledWith("new-profile-id");
  });
});
