import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "@/lib/tauri";
import { isBrokeredProfile, type Profile } from "@/lib/profiles";

export interface ConnectGrant {
  endpoint: { host: string; port: number };
  token: string;
}

interface SignResult {
  ts: number;
  sig: string;
}

/**
 * Calls a brokered profile's `brokerUrl` (journal/62 CT-1) for a fresh
 * connection grant. Generic on purpose — this code has no idea what API it's
 * actually talking to: it signs an empty POST body against `brokerUrl`'s
 * path with the device identity (`tailnet_sidecar_sign`, F2) and sends it
 * with the header names CT-1 defines (`X-Node-Id`/`Ts`/`Sig`), deliberately
 * not the `X-Anywh-*` convention `anywh-control-plane` uses among its own
 * internal services — a self-hoster's own broker could register these same
 * three names without ever learning that convention exists. Only
 * `{endpoint, token}` from the response is read; anything else
 * (`expiresInSeconds`, or any anywh-specific field) is ignored.
 *
 * Must be called fresh before every new connection, never cached —
 * journal/49 D4: the token authorizes exactly one handshake.
 */
export async function fetchConnectGrant(profile: Profile): Promise<ConnectGrant> {
  if (!isBrokeredProfile(profile)) throw new Error("profile has no broker configured");
  if (!inTauri()) throw new Error("the broker call needs the Tauri sidecar to sign it, not available in a plain browser");

  const url = new URL(profile.brokerUrl!);
  const { ts, sig } = await invoke<SignResult>("tailnet_sidecar_sign", {
    method: "POST",
    path: url.pathname,
    body: "",
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-Node-Id": profile.brokerNodeId!,
      "X-Node-Ts": String(ts),
      "X-Node-Sig": sig,
    },
  });
  if (!response.ok) throw new Error(`broker refused the connection request (${String(response.status)})`);
  const body = (await response.json()) as Partial<ConnectGrant>;
  if (!body.endpoint || typeof body.token !== "string") throw new Error("broker response missing endpoint/token");
  return { endpoint: body.endpoint, token: body.token };
}
