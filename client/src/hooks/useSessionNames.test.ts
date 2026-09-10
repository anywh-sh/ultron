import { cleanup, renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/lib/profiles";

const { fetchSessionsMock, resolveConnectionMock } = vi.hoisted(() => ({
  fetchSessionsMock: vi.fn(async () => []),
  resolveConnectionMock: vi.fn(),
}));
vi.mock("@/lib/relayClient", () => ({ fetchSessions: fetchSessionsMock }));
vi.mock("@/lib/connectionResolver", () => ({ resolveConnection: resolveConnectionMock }));

/** Minimal stand-in for the browser `WebSocket`, same shape as
 * relayClient.test.ts's own fixture. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly OPEN = 1;
  readyState = 0;
  private listeners = new Map<string, ((event: unknown) => void)[]>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const existing = this.listeners.get(type) ?? [];
    this.listeners.set(type, [...existing, listener]);
  }

  emit(type: string, event: unknown = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  close(): void {
    this.emit("close");
  }
}

import { useSessionNames } from "@/hooks/useSessionNames";

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
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  fetchSessionsMock.mockClear().mockResolvedValue([]);
  resolveConnectionMock.mockReset();
  let call = 0;
  resolveConnectionMock.mockImplementation(async () => {
    call += 1;
    return { host: "127.0.0.1", port: 54321, token: `grant-token-${String(call)}` };
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useSessionNames", () => {
  it("fetches the session list through the resolved connection, token included", async () => {
    await act(async () => {
      renderHook(() => useSessionNames(tailnetProfile));
      await vi.runAllTimersAsync();
    });
    expect(fetchSessionsMock).toHaveBeenCalledWith("127.0.0.1", 54321, "grant-token-1");
  });

  it("opens the sessions/watch socket with the resolved token as a query param", async () => {
    await act(async () => {
      renderHook(() => useSessionNames(tailnetProfile));
      await vi.runAllTimersAsync();
    });
    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toBe("ws://127.0.0.1:54321/sessions/watch?token=grant-token-2");
  });

  it("resolves a fresh grant (not the first connection's) when the watch socket reconnects", async () => {
    await act(async () => {
      renderHook(() => useSessionNames(tailnetProfile));
      await vi.runAllTimersAsync();
    });
    const firstSocket = FakeWebSocket.instances[0];
    expect(firstSocket.url).toContain("grant-token-2");

    await act(async () => {
      firstSocket.close();
      await vi.advanceTimersByTimeAsync(2000);
    });

    const secondSocket = FakeWebSocket.instances[1];
    // A brand-new connection needs its own unspent token (journal/49 D4) —
    // reusing the first one would be rejected as a replay by the proxy.
    expect(secondSocket.url).not.toBe(firstSocket.url);
    expect(secondSocket.url).toContain("grant-token-3");
  });
});
