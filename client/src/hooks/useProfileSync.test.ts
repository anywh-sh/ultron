import { cleanup, renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/lib/profiles";

const { fetchControlProfilesMock, syncProfilesForHostMock, resolveConnectionMock } = vi.hoisted(() => ({
  fetchControlProfilesMock: vi.fn(async () => []),
  syncProfilesForHostMock: vi.fn(),
  resolveConnectionMock: vi.fn(),
}));
vi.mock("@/lib/relayClient", () => ({ fetchControlProfiles: fetchControlProfilesMock }));
vi.mock("@/lib/connectionResolver", () => ({ resolveConnection: resolveConnectionMock }));
vi.mock("@/lib/profiles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/profiles")>()),
  syncProfilesForHost: syncProfilesForHostMock,
}));

import { useProfileSync } from "@/hooks/useProfileSync";

// Every tailnet profile shares the same placeholder host (journal/62 F4) —
// only `id` tells them apart.
const tailnetProfile: Profile = {
  id: "sandbox-a",
  label: "Sandbox A",
  host: "127.0.0.1",
  relayPort: 0,
  tailnetAuthKey: "key",
  tailnetControlUrl: "https://headscale.test",
  tailnetTarget: "100.64.0.1:8765",
};

beforeEach(() => {
  fetchControlProfilesMock.mockClear().mockResolvedValue([]);
  syncProfilesForHostMock.mockClear();
  resolveConnectionMock.mockReset().mockResolvedValue({ host: "127.0.0.1", port: 54321, token: "grant-token" });
});

afterEach(() => {
  cleanup();
});

describe("useProfileSync", () => {
  it("fetches through the resolved connection but stores the sync under the profile's own advertised host", async () => {
    await act(async () => {
      renderHook(({ profile }) => useProfileSync(profile), { initialProps: { profile: tailnetProfile } });
    });

    expect(fetchControlProfilesMock).toHaveBeenCalledWith("127.0.0.1", 54321, "grant-token");
    // `syncProfilesForHost` keys deduping/dropping by the profile's *own*
    // host field (the tailnet placeholder here), never the sidecar's
    // resolved local port — passing the resolved host would break the
    // dedup logic in profiles.ts for every subsequent sync.
    expect(syncProfilesForHostMock).toHaveBeenCalledWith(tailnetProfile.host, []);
  });

  it("doesn't apply a stale response after switching to a different tailnet profile sharing the same host", async () => {
    let resolveFirstFetch: (value: never[]) => void = () => undefined;
    fetchControlProfilesMock.mockImplementationOnce(
      () => new Promise((resolve: (value: never[]) => void) => { resolveFirstFetch = resolve; }),
    );

    const { rerender } = renderHook(({ profile }) => useProfileSync(profile), {
      initialProps: { profile: tailnetProfile },
    });

    const otherTailnetProfile: Profile = { ...tailnetProfile, id: "sandbox-b" };
    await act(async () => {
      rerender({ profile: otherTailnetProfile });
    });

    await act(async () => {
      resolveFirstFetch([]);
      await Promise.resolve();
    });

    // The first profile's late response must not have counted as a sync —
    // only the second profile's own (immediate, already-resolved) fetch did.
    expect(syncProfilesForHostMock).toHaveBeenCalledTimes(1);
  });
});
