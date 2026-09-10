import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "@/lib/tauri";

export interface ClaimedBundle {
  nodeId: string;
  controlUrl: string;
  authKey: string;
}

/**
 * Redeems a one-time join code against a generic `claimUrl` a deep link
 * supplies (journal/62 F4) — generates (or loads, if this device already
 * paired once before) this device's own Ed25519 identity first
 * (`tailnet_sidecar_identity`, F2) and sends only its public half; the
 * private key never leaves the device, and never transits through the deep
 * link at all. Generic on the same terms as `fetchConnectGrant`
 * (tailnetBroker.ts): the response is interpreted as
 * `{nodeId, controlUrl, authKey, ...}`, anything else (`proxyListenPort`,
 * `signingKeys` — control-plane-internal, meaningless to this client) is
 * ignored.
 */
export async function claimTailnetBundle(claimUrl: string, joinCode: string): Promise<ClaimedBundle> {
  if (!inTauri()) {
    throw new Error("claiming a tailnet profile needs the Tauri sidecar to generate an identity, not available in a plain browser");
  }
  const publicKey = await invoke<string>("tailnet_sidecar_identity");
  // Temporary: /v1/connect started failing with a signature mismatch right
  // after a successful claim on Windows. This identity is public — safe to
  // log — and lets a claim-time value be compared against the one
  // tailnetBroker.ts logs at sign time, to tell "wrong key" apart from "bad
  // payload". Remove once that's root-caused.
  console.log(`[ultron] claiming with identity public key: ${publicKey}`);

  const response = await fetch(claimUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ joinCode, publicKey }),
  });
  if (!response.ok) throw new Error(`claim failed (${String(response.status)})`);
  const body = (await response.json()) as Partial<ClaimedBundle>;
  if (!body.nodeId || !body.controlUrl || !body.authKey) {
    throw new Error("claim response missing nodeId/controlUrl/authKey");
  }
  return { nodeId: body.nodeId, controlUrl: body.controlUrl, authKey: body.authKey };
}
