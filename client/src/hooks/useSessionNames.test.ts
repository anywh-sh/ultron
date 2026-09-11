import { cleanup, renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/lib/profiles";
import type { SessionSummary } from "@/lib/relay-types";
import { BrokerRevokedError } from "@/lib/tailnetBroker";

const { fetchSessionsMock, resolveConnectionMock } = vi.hoisted(() => ({
  fetchSessionsMock: vi.fn(async (): Promise<SessionSummary[]> => []),
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

  it("stops retrying the sessions/watch socket once the device's connection was permanently revoked", async () => {
    resolveConnectionMock.mockReset();
    resolveConnectionMock.mockRejectedValue(new BrokerRevokedError());
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await act(async () => {
      renderHook(() => useSessionNames(tailnetProfile));
      await vi.runAllTimersAsync();
    });

    expect(FakeWebSocket.instances).toHaveLength(0);
    const callsAfterInitialFailure = resolveConnectionMock.mock.calls.length;

    // A generous window well past the fixed 2s retry this socket otherwise
    // uses — if a reconnect were still scheduled, this would fire several.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(resolveConnectionMock.mock.calls.length).toBe(callsAfterInitialFailure);
    consoleErrorSpy.mockRestore();
  });

  it("switching profile A -> B never shows A's sessions in the next render", async () => {
    fetchSessionsMock.mockResolvedValueOnce([{ id: "s1", title: "From A" }]);
    const profileB: Profile = { ...tailnetProfile, id: "sandbox-b" };

    const { result, rerender } = renderHook(({ profile }) => useSessionNames(profile), {
      initialProps: { profile: tailnetProfile },
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(result.current.sessions).toEqual([{ id: "s1", title: "From A" }]);

    fetchSessionsMock.mockResolvedValueOnce([]);
    rerender({ profile: profileB });
    // The render right after the switch — before the new profile's fetch
    // effect has any chance to run — must already show the skeleton state,
    // not a frame with A's sessions still in it.
    expect(result.current.sessions).toEqual([]);
    expect(result.current.loading).toBe(true);

    await act(async () => {
      await vi.runAllTimersAsync();
    });
  });

  it("sets error when the one-shot fetch rejects", async () => {
    resolveConnectionMock.mockRejectedValueOnce(new Error("network down"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() => useSessionNames(tailnetProfile));
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.error).toBe(true);
    expect(result.current.loading).toBe(false);
    consoleErrorSpy.mockRestore();
  });

  it("reload() clears the error, shows the skeleton again, and refetches", async () => {
    resolveConnectionMock.mockRejectedValueOnce(new Error("network down"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() => useSessionNames(tailnetProfile));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(result.current.error).toBe(true);

    act(() => {
      result.current.reload();
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBe(false);

    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(result.current.error).toBe(false);
    expect(result.current.loading).toBe(false);
    consoleErrorSpy.mockRestore();
  });
});
