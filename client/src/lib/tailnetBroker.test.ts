import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/lib/profiles";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (_cmd: string, _args?: unknown) => ({ ts: Date.now(), sig: `sig-${String(Date.now())}` })),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@/lib/tauri", () => ({ inTauri: () => true }));

import { fetchConnectGrant, resolveTailnetTarget } from "@/lib/tailnetBroker";

const profile: Profile = {
  id: "p1",
  label: "Sandbox",
  host: "127.0.0.1",
  relayPort: 0,
  tailnetAuthKey: "key",
  tailnetControlUrl: "https://headscale.test",
  brokerUrl: "https://api.test/v1/connect/w1",
  brokerNodeId: "node-1",
};

const staticProfile: Profile = {
  id: "p2",
  label: "Manual",
  host: "127.0.0.1",
  relayPort: 0,
  tailnetAuthKey: "key",
  tailnetControlUrl: "https://headscale.test",
  tailnetTarget: "100.64.0.9:9000",
  connectToken: "static-token",
};

function resuming(): Response {
  return new Response(JSON.stringify({ state: "resuming", retry_after_ms: 1500, eta_ms: 5000 }), { status: 409 });
}

function granted(): Response {
  return new Response(JSON.stringify({ endpoint: { host: "100.64.0.1", port: 8443 }, token: "tok" }), { status: 200 });
}

beforeEach(() => {
  vi.useFakeTimers();
  invokeMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fetchConnectGrant", () => {
  it("waits out a broker that answers 409 'resuming' and takes the grant when it comes", async () => {
    // The compute this profile points at was suspended (its sandbox died and
    // the control plane reconciled it), so the first attempts land while the
    // resume is still in flight.
    const fetchMock = vi.fn().mockResolvedValueOnce(resuming()).mockResolvedValueOnce(resuming()).mockResolvedValueOnce(granted());
    vi.stubGlobal("fetch", fetchMock);

    const grant = fetchConnectGrant(profile);
    await vi.runAllTimersAsync();

    expect(await grant).toEqual({ endpoint: { host: "100.64.0.1", port: 8443 }, token: "tok" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Every attempt has to carry its own signature — the control plane's
    // anti-replay (journal/49 D4) rejects a repeated one, so a retry that
    // reused the first would fail for a reason that has nothing to do with
    // the resume.
    const signCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === "tailnet_sidecar_sign");
    expect(signCalls).toHaveLength(3);
    const signatures = fetchMock.mock.calls.map(([, init]) => (init as RequestInit).headers as Record<string, string>);
    expect(new Set(signatures.map((h) => h["X-Node-Sig"])).size).toBe(3);
  });

  it("gives up once the resume has clearly not happened", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resuming()));

    const grant = fetchConnectGrant(profile);
    const assertion = expect(grant).rejects.toThrow(/resum/i);
    await vi.runAllTimersAsync();
    await assertion;
  });

  it("still fails immediately on a refusal that is not a resume", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 403 })));

    const grant = fetchConnectGrant(profile);
    const assertion = expect(grant).rejects.toThrow(/403/);
    await vi.runAllTimersAsync();
    await assertion;
  });
});

describe("resolveTailnetTarget", () => {
  it("resolves a brokered profile's target (and token) from a fresh grant", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(granted()));
    await expect(resolveTailnetTarget(profile)).resolves.toEqual({ target: "100.64.0.1:8443", token: "tok" });
  });

  it("resolves a static profile's target/token straight from its own fields, no network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveTailnetTarget(staticProfile)).resolves.toEqual({
      target: "100.64.0.9:9000",
      token: "static-token",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws for a profile with neither a broker nor a static target", async () => {
    const misconfigured: Profile = { ...staticProfile, tailnetTarget: undefined };
    await expect(resolveTailnetTarget(misconfigured)).rejects.toThrow(/no target to dial/);
  });
});
