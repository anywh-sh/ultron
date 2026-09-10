import { discoverPairingEndpoints, parsePairingCode } from "@/lib/pairingCode";
import { addProfile } from "@/lib/profiles";
import { claimTailnetBundle } from "@/lib/tailnetClaim";

/**
 * Generic remote-profile import via a deep link:
 * `anywh://import-profile?label=&host=&port=&token=` (direct mode) or
 * `anywh://import-profile?label=&claimUrl=&joinCode=&brokerUrl=` (tailnet
 * mode, journal/62 F4). Nothing here is specific to any one hosted service
 * — it's the same shape a self-hoster could hand out for their own relay
 * (`host`/`port` to reach it directly, an optional `token` for a reverse
 * proxy gating access) or their own broker (a `claimUrl` to redeem a code
 * against, a `brokerUrl` to ask for connections afterward — CT-1).
 * `DEFAULT_PROFILES`'s own comment in profiles.ts already anticipated a
 * flow like this calling `addProfile`.
 *
 * `importFromPairingCode` below is the same tailnet mode reached from a
 * typed `<join-code>@<host>` code instead of a link — it resolves the same
 * fields through discovery and then joins this exact path.
 */
export interface ImportedProfileParams {
  label: string;
  host?: string;
  port?: number;
  connectToken?: string;
  claimUrl?: string;
  joinCode?: string;
  brokerUrl?: string;
}

const IMPORT_PROFILE_ACTION = "import-profile";

/**
 * Parses a deep link URL into import params, or `null` if it isn't a
 * recognized `anywh://import-profile` link, is missing `label`, or has
 * neither a complete direct-mode (`host`+`port`) nor tailnet-mode
 * (`claimUrl`+`joinCode`) set of fields. Pure — no side effect — so the
 * parsing itself is testable without touching
 * `profiles.ts`/`localStorage`/Tauri at all.
 *
 * `brokerUrl` is optional in tailnet mode: a link that names one pins it
 * (that's what anywh-app's dialog does, since its broker is per workspace
 * and the link is built where the workspace is known), and a link that
 * doesn't falls back to whatever the claim response carries. Either way the
 * value is opaque here — CT-1.
 */
export function parseImportProfileUrl(url: string): ImportedProfileParams | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "anywh:") return null;
  // A custom scheme has no real authority component — most URL parsers
  // (including this one) still put the part right after `://` into
  // `.hostname`, which is where `import-profile` lands here.
  if (parsed.hostname !== IMPORT_PROFILE_ACTION) return null;

  const params = parsed.searchParams;
  const label = params.get("label");
  if (!label) return null;

  const hostRaw = params.get("host");
  const portRaw = params.get("port");
  if (hostRaw && portRaw) {
    const port = Number(portRaw);
    if (!Number.isFinite(port) || port <= 0) return null;
    return { label, host: hostRaw, port, connectToken: params.get("token") ?? undefined };
  }

  const claimUrl = params.get("claimUrl");
  const joinCode = params.get("joinCode");
  const brokerUrl = params.get("brokerUrl");
  if (claimUrl && joinCode) return { label, claimUrl, joinCode, brokerUrl: brokerUrl ?? undefined };

  return null;
}

/**
 * Adds the imported profile to the local list (`addProfile`, profiles.ts)
 * and returns its generated id, so the caller can switch to it right away.
 * The id is always generated here (not by any server) — for a tailnet-mode
 * import this is still true even though `claimTailnetBundle` does hit the
 * network: that call registers this *device* on the account, it never
 * allocates a *local profile* id, which has no server-side counterpart at
 * all (same as `AddProfileDialog`'s direct-mode flow never had one).
 */
export async function importProfile(params: ImportedProfileParams): Promise<string> {
  const id = crypto.randomUUID();
  if (params.claimUrl && params.joinCode) {
    const bundle = await claimTailnetBundle(params.claimUrl, params.joinCode);
    // Caller-supplied wins over claim-supplied: an explicit `brokerUrl` in
    // the link was chosen by whoever built the link, which is a stronger
    // statement than a server default.
    const brokerUrl = params.brokerUrl ?? bundle.brokerUrl;
    addProfile({
      id,
      label: params.label,
      // Placeholder — useRelayClient (F2/F3) always replaces these with the
      // tailnet-sidecar's local address before ever opening a WebSocket; a
      // brokered profile never dials host/relayPort directly.
      host: "127.0.0.1",
      relayPort: 0,
      tailnetControlUrl: bundle.controlUrl,
      tailnetAuthKey: bundle.authKey,
      brokerUrl,
      brokerNodeId: bundle.nodeId,
      tailnetReportUrl: bundle.reportUrl,
    });
  } else {
    addProfile({
      id,
      label: params.label,
      host: params.host!,
      relayPort: params.port!,
      connectToken: params.connectToken,
    });
  }
  return id;
}

/**
 * The typed-code counterpart of a tailnet-mode deep link: resolves
 * `<join-code>@<host>` through the host's own discovery document
 * (pairingCode.ts) and hands the result to `importProfile`, so both entry
 * points converge on one redemption path.
 *
 * Split out rather than folded into `importProfile` because the two differ
 * in exactly one thing — where `claimUrl` comes from — and the extra step
 * is the only part that can fail before any code is spent. Rejecting a
 * malformed code here means a mistyped one never reaches the network, and
 * so never burns one of the five attempts the code allows.
 */
export async function importFromPairingCode(label: string, code: string): Promise<string> {
  const parsed = parsePairingCode(code);
  if (!parsed) throw new Error("malformed pairing code");
  const endpoints = await discoverPairingEndpoints(parsed.origin);
  return importProfile({
    label,
    claimUrl: endpoints.claimUrl,
    joinCode: parsed.joinCode,
    brokerUrl: endpoints.brokerUrl,
  });
}
