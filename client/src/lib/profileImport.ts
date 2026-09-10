import { addProfile } from "@/lib/profiles";
import { claimTailnetBundle } from "@/lib/tailnetClaim";

/**
 * Generic remote-profile import via a deep link:
 * `ultron://import-profile?label=&host=&port=&token=` (direct mode) or
 * `ultron://import-profile?label=&claimUrl=&joinCode=&brokerUrl=` (tailnet
 * mode, journal/62 F4). Nothing here is specific to any one hosted service
 * — it's the same shape a self-hoster could hand out for their own relay
 * (`host`/`port` to reach it directly, an optional `token` for a reverse
 * proxy gating access) or their own broker (a `claimUrl` to redeem a code
 * against, a `brokerUrl` to ask for connections afterward — CT-1).
 * `DEFAULT_PROFILES`'s own comment in profiles.ts already anticipated a
 * flow like this calling `addProfile`.
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
 * recognized `ultron://import-profile` link, is missing `label`, or has
 * neither a complete direct-mode (`host`+`port`) nor tailnet-mode
 * (`claimUrl`+`joinCode`+`brokerUrl`) set of fields. Pure — no side effect —
 * so the parsing itself is testable without touching
 * `profiles.ts`/`localStorage`/Tauri at all.
 */
export function parseImportProfileUrl(url: string): ImportedProfileParams | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "ultron:") return null;
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
  if (claimUrl && joinCode && brokerUrl) return { label, claimUrl, joinCode, brokerUrl };

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
  if (params.claimUrl && params.joinCode && params.brokerUrl) {
    const bundle = await claimTailnetBundle(params.claimUrl, params.joinCode);
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
      brokerUrl: params.brokerUrl,
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
