import type { Profile } from "@/lib/profiles";

export interface FsEntry {
  name: string;
  path: string;
}

export interface FsListResult {
  path: string;
  entries: FsEntry[];
}

/** Lists subfolders of `path` on the relay (the machine where the agent
 * runs, not the client device) — see relay/src/fsBrowse.ts for the full
 * contract. Without `path`, the relay resolves to the app's (profile's)
 * default. */
export async function listDirectories(profile: Profile, path?: string): Promise<FsListResult> {
  const qs = path ? `?path=${encodeURIComponent(path)}` : "";
  const response = await fetch(`http://${profile.host}:${profile.relayPort}/fs/list${qs}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return response.json();
}
