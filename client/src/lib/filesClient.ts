import type { EditorLocality } from "@/lib/editorLinks";
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

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
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

/** `dir` omitted creates at the session's root — today the only caller
 * (`FileTree`'s panel-level "new file" context menu) never creates inside a
 * specific folder. */
export async function createFile(profile: Profile, sessionId: string, name: string, dir?: string): Promise<{ path: string }> {
  return postJson(`${baseUrl(profile)}/files/create`, { session: sessionId, dir: dir ?? null, name });
}

/** `dir` omitted uploads at the session's root — mirrors `createFile`'s
 * confinement/fail-closed behavior (relay/src/fsFiles.ts), just with the
 * dropped file's bytes as content instead of an empty file. `content` is
 * sent as the raw request body (not multipart/JSON), same style as
 * `imageUpload.ts`'s `uploadAttachment`. */
export async function uploadFile(profile: Profile, sessionId: string, name: string, content: ArrayBuffer, dir?: string): Promise<{ path: string }> {
  const params = new URLSearchParams({ session: sessionId, name });
  if (dir) params.set("dir", dir);
  const response = await fetch(`${baseUrl(profile)}/files/upload?${params.toString()}`, {
    method: "POST",
    body: content,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${String(response.status)}`);
  }
  return response.json() as Promise<{ path: string }>;
}

/** File-only write surface — the context menu that drives these (`FileTree`)
 * never shows delete/rename for a directory row. */
export async function deleteFile(profile: Profile, sessionId: string, path: string): Promise<void> {
  await postJson(`${baseUrl(profile)}/files/delete`, { session: sessionId, path });
}

/** Renames within the same directory — `newName` is a bare filename, never
 * a full path (see `relay/src/fsFiles.ts`). Returns the new absolute path
 * so the caller can move an open tab to follow the file. */
export async function renameFile(profile: Profile, sessionId: string, path: string, newName: string): Promise<{ path: string }> {
  return postJson(`${baseUrl(profile)}/files/rename`, { session: sessionId, path, newName });
}

export interface HostInfo {
  hostname: string;
  platform: string;
  editor: EditorLocality;
}

/** Whether/how the client can open a file panel path in a local editor
 * (journal/60) — `editor: null` means both `ULTRON_EDITOR_LOCAL` and
 * `ULTRON_EDITOR_SSH` are unset relay-side, and the feature should be
 * hidden entirely (see `relay/src/editorHostInfo.ts`). */
export async function getHostInfo(profile: Profile): Promise<HostInfo> {
  return getJson<HostInfo>(`${baseUrl(profile)}/host-info`);
}
