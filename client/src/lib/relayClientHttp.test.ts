import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSessions, renameSession } from "@/lib/relayClient";

afterEach(() => {
  vi.unstubAllGlobals();
});

// A tailnet connection needs a fresh connect token attached to every call
// (journal/62, "O anywh-proxy verifica um connect token válido... em toda
// conexão TCP") — a direct-mode call (no token) must keep working exactly
// as before, with no stray Authorization header.
describe("relayClient HTTP helpers, connect token", () => {
  it("fetchSessions attaches an Authorization header when a token is given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ sessions: [] }))) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await fetchSessions("127.0.0.1", 54321, "grant-token");

    const [, init] = (fetchMock as unknown as { mock: { calls: [string, RequestInit | undefined][] } }).mock.calls[0];
    expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBe("Bearer grant-token");
  });

  it("fetchSessions sends no Authorization header when no token is given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ sessions: [] }))) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await fetchSessions("127.0.0.1", 8765);

    const [, init] = (fetchMock as unknown as { mock: { calls: [string, RequestInit | undefined][] } }).mock.calls[0];
    expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBeUndefined();
  });

  it("renameSession merges the Authorization header with its own Content-Type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    await renameSession("127.0.0.1", 54321, "session-1", "New title", "grant-token");

    const [, init] = (fetchMock as unknown as { mock: { calls: [string, RequestInit | undefined][] } }).mock.calls[0];
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe("Bearer grant-token");
    expect(headers?.["Content-Type"]).toBe("application/json");
  });
});
