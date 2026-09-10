import { addProfile } from "@/lib/profiles";

/**
 * Generic remote-profile import via a deep link: `ultron://import-profile?
 * host=&port=&label=&token=`. Nothing here is specific to any one hosted
 * service — it's the same shape a self-hoster could hand out for their own
 * relay (`host`/`port` to reach it, an optional `token` for a reverse proxy
 * gating access, see `Profile.connectToken`). `DEFAULT_PROFILES`'s own
 * comment in profiles.ts already anticipated a flow like this calling
 * `addProfile`.
 */
export interface ImportedProfileParams {
  host: string;
  port: number;
  label: string;
  connectToken?: string;
}

const IMPORT_PROFILE_ACTION = "import-profile";

/**
 * Parses a deep link URL into import params, or `null` if it isn't a
 * recognized `ultron://import-profile` link or is missing a required field.
 * Pure — no side effect — so the parsing itself is testable without
 * touching `profiles.ts`/`localStorage` at all.
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
  const host = params.get("host");
  const portRaw = params.get("port");
  const label = params.get("label");
  if (!host || !portRaw || !label) return null;

  const port = Number(portRaw);
  if (!Number.isFinite(port) || port <= 0) return null;

  return { host, port, label, connectToken: params.get("token") ?? undefined };
}

/**
 * Adds the imported profile to the local list (`addProfile`, profiles.ts)
 * and returns its generated id, so the caller can switch to it right away —
 * the id is generated here (not by any server), since there is no
 * provisioning round-trip in this flow at all, unlike `AddProfileDialog`.
 */
export function importProfile(params: ImportedProfileParams): string {
  const id = crypto.randomUUID();
  addProfile({
    id,
    label: params.label,
    host: params.host,
    relayPort: params.port,
    connectToken: params.connectToken,
  });
  return id;
}
