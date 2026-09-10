import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/lib/profiles";

// `vi.hoisted` because these mocks are read by modules this file imports
// statically — the `vi.mock` factories run before the top-level bindings.
const { invokeMock, connectMock, constructedMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (cmd: string, _args?: unknown) => {
    if (cmd === "tailnet_sidecar_start") return "127.0.0.1:12345";
    return undefined;
  }),
  connectMock: vi.fn(),
  constructedMock: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@/lib/tauri", () => ({ inTauri: () => true }));

// The real broker call is signed by the Tauri sidecar and hits the network —
// only its resolved target matters here.
vi.mock("@/lib/tailnetBroker", () => ({
  fetchConnectGrant: vi.fn(async () => ({ endpoint: { host: "100.64.0.1", port: 8765 }, token: "grant-token" })),
}));

// A real RelayClient would open a WebSocket; the connection itself is not
// what this file is about.
vi.mock("@/lib/relayClient", () => ({
  RelayClient: class {
    connect = connectMock;
    disconnect = vi.fn();
    constructor(...args: unknown[]) {
      constructedMock(...args);
    }
  },
}));

import { useRelayClient } from "@/hooks/useRelayClient";

// A brokered tailnet profile — `host`/`relayPort` are the placeholder
// profileImport.ts writes, never dialed directly (see useRelayClient).
const tailnetProfile: Profile = {
  id: "tailnet-profile",
  label: "Tailnet",
  host: "127.0.0.1",
  relayPort: 0,
  tailnetAuthKey: "key",
  tailnetControlUrl: "https://headscale.test",
  brokerUrl: "https://api.test/v1/connect/w1",
  brokerNodeId: "node-1",
};

beforeEach(() => {
  vi.useFakeTimers();
  invokeMock.mockClear();
  connectMock.mockClear();
  constructedMock.mockClear();
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

describe("useRelayClient tailnet mode", () => {
  it("does not stop a sidecar another tab is still using when a tab unmounts before acquiring it", async () => {
    // Tab A: mounted and settled, so it holds the only reference to the
    // profile's sidecar.
    const tabA = renderHook(() => useRelayClient(tailnetProfile, "session-a"));
    await vi.runAllTimersAsync();
    expect(invokeMock).toHaveBeenCalledWith("tailnet_sidecar_start", expect.anything());

    // Tab B: opened and closed again before its own deferred `start()` ever
    // ran, so it never acquired the sidecar in the first place — its cleanup
    // must not release a reference it doesn't hold.
    const tabB = renderHook(() => useRelayClient(tailnetProfile, "session-b"));
    tabB.unmount();
    await vi.runAllTimersAsync();

    expect(invokeMock).not.toHaveBeenCalledWith("tailnet_sidecar_stop", expect.anything());

    tabA.unmount();
    await vi.runAllTimersAsync();
  });

  it("hands the relay client a token resolver, not the single grant it opened with", async () => {
    // journal/49 D4: the broker's token authorizes one handshake, so the
    // client has to be able to ask for another one — see relayClient.test.ts
    // for what it does with this.
    renderHook(() => useRelayClient(tailnetProfile, "session-a"));
    await vi.runAllTimersAsync();

    const [host, port, , , token] = constructedMock.mock.calls[0] as [string, number, unknown, unknown, unknown];
    expect({ host, port }).toEqual({ host: "127.0.0.1", port: 12345 });
    expect(typeof token).toBe("function");
    await expect((token as () => Promise<string>)()).resolves.toBe("grant-token");
  });
});
