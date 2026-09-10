import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/lib/profiles";

const invokeMock = vi.fn(async (cmd: string, _args?: unknown) => {
  if (cmd === "tailnet_sidecar_start") return "127.0.0.1:12345";
  return undefined;
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

// acquireTailnetSidecar/releaseTailnetSidecar only read `id`, `tailnetAuthKey`
// and `tailnetControlUrl` off a Profile — nothing else in this fixture matters.
function profile(id: string): Profile {
  return { id, label: id, host: "127.0.0.1", relayPort: 0, tailnetAuthKey: "key", tailnetControlUrl: "https://example.test" };
}

beforeEach(() => {
  vi.useFakeTimers();
  invokeMock.mockClear();
  // acquireTailnetSidecar/releaseTailnetSidecar branch on this — see tauri.ts.
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

describe("tailnetSidecar", () => {
  it("cancels the deferred teardown when the same profile is reacquired before it fires", async () => {
    const { acquireTailnetSidecar, releaseTailnetSidecar } = await import("@/lib/tailnetSidecar");
    const id = "reacquire-before-timeout";

    const first = acquireTailnetSidecar(profile(id), "target:1");
    releaseTailnetSidecar(id);
    // React 18 StrictMode's mount/cleanup/mount replay is exactly this:
    // release then immediately reacquire, synchronously, before any timer
    // has a chance to run.
    const second = acquireTailnetSidecar(profile(id), "target:1");

    await vi.runAllTimersAsync();

    expect(await first).toEqual(await second);
    expect(invokeMock).toHaveBeenCalledTimes(1); // only the one tailnet_sidecar_start
    expect(invokeMock).not.toHaveBeenCalledWith("tailnet_sidecar_stop", expect.anything());

    releaseTailnetSidecar(id);
    await vi.runAllTimersAsync();
  });

  it("tears down for real once nothing reacquires it", async () => {
    const { acquireTailnetSidecar, releaseTailnetSidecar } = await import("@/lib/tailnetSidecar");
    const id = "real-teardown";

    await acquireTailnetSidecar(profile(id), "target:1");
    releaseTailnetSidecar(id);
    await vi.runAllTimersAsync();

    expect(invokeMock).toHaveBeenCalledWith("tailnet_sidecar_stop", { profileId: id });
  });
});
