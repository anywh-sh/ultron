import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { rawFileUrl } from "@/lib/filesClient";
import type { Profile } from "@/lib/profiles";

/**
 * Saves a session file to a location the user picks on their own machine —
 * distinct from `/files/raw` (which only ever serves bytes to the webview).
 * The native save dialog grants the fs plugin write access to whatever path
 * it returns without a broader `fs` scope (Tauri v2: the selected path is
 * added to the fs/asset-protocol scopes for the picked path only), so the
 * `fs:allow-write-file` capability here never has to allow arbitrary paths.
 * `null` back from `save()` means the user cancelled — a no-op, not an
 * error.
 */
export async function downloadFile(profile: Profile, sessionId: string, path: string, name: string, mtimeMs: number): Promise<void> {
  const target = await save({ defaultPath: name });
  if (!target) return;

  const response = await fetch(rawFileUrl(profile, sessionId, path, mtimeMs));
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(target, bytes);
}
