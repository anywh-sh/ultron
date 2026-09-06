import type { Profile } from "@/lib/profiles";

// Client for the work dir file panel's protocol (docs/41) — mirrors
// `fsBrowse.ts`'s pattern (thin fetch wrappers over the relay's HTTP API),
// but rooted at a session's cwd instead of an arbitrary path (see
// relay/src/fsFiles.ts).

export interface FileEntry {
  name: string;
  path: string;
  kind: "dir" | "file";
  size: number;
  mtimeMs: number;
}

export interface FilesListResult {
  root: string;
  path: string;
  entries: FileEntry[];
}

export type FileReadResult =
  | { kind: "text"; path: string; content: string; size: number; mtimeMs: number; truncated: boolean }
  | { kind: "image"; path: string; size: number; mtimeMs: number; mime: string }
  | { kind: "binary"; path: string; size: number; mtimeMs: number };

function baseUrl(profile: Profile): string {
  return `http://${profile.host}:${profile.relayPort}`;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${String(response.status)}`);
  }
  return response.json() as Promise<T>;
}

/** `path` omitted lists the session's root. Lazy by design — the caller
 * (`FileTree`) only ever asks for one folder at a time, never recursively. */
export async function listFiles(profile: Profile, sessionId: string, path?: string, showHidden?: boolean): Promise<FilesListResult> {
  const params = new URLSearchParams({ session: sessionId });
  if (path) params.set("path", path);
  if (showHidden) params.set("all", "1");
  return getJson<FilesListResult>(`${baseUrl(profile)}/files/list?${params.toString()}`);
}

export async function readFile(profile: Profile, sessionId: string, path: string): Promise<FileReadResult> {
  const params = new URLSearchParams({ session: sessionId, path });
  return getJson<FileReadResult>(`${baseUrl(profile)}/files/read?${params.toString()}`);
}

/** `?v=<mtimeMs>` busts the webview's cache so a changed image (agent
 * overwrote it, or the watch — docs/41 phase 5 — noticed a change) actually
 * reloads instead of showing stale bytes. */
export function rawFileUrl(profile: Profile, sessionId: string, path: string, mtimeMs: number): string {
  const params = new URLSearchParams({ session: sessionId, path, v: String(mtimeMs) });
  return `${baseUrl(profile)}/files/raw?${params.toString()}`;
}
