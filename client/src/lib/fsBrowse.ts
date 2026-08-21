import type { Profile } from "@/lib/profiles";

export interface FsEntry {
  name: string;
  path: string;
}

export interface FsListResult {
  path: string;
  entries: FsEntry[];
}

/** Lista subpastas de `path` no relay (máquina onde o agente roda, não no
 * dispositivo do cliente) — ver relay/src/fsBrowse.ts pro contrato completo.
 * Sem `path`, o relay resolve pro padrão do app (perfil). */
export async function listDirectories(profile: Profile, path?: string): Promise<FsListResult> {
  const qs = path ? `?path=${encodeURIComponent(path)}` : "";
  const response = await fetch(`http://${profile.host}:${profile.relayPort}/fs/list${qs}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return response.json();
}
