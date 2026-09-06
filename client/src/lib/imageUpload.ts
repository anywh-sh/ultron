import type { Profile } from "@/lib/profiles";

export interface UploadResult {
  path: string;
  /** Only present for video — paths of the frames extracted on the relay via
   * ffmpeg (see `relay/src/uploads.ts`), in chronological order. */
  frames?: string[];
}

export async function uploadAttachment(profile: Profile, file: File): Promise<UploadResult> {
  const ext = file.name.includes(".") ? (file.name.split(".").pop() ?? "png") : "png";
  const buffer = await file.arrayBuffer();

  const response = await fetch(`http://${profile.host}:${profile.relayPort}/upload?ext=${encodeURIComponent(ext)}`, {
    method: "POST",
    body: buffer,
  });
  if (!response.ok) {
    throw new Error(`upload falhou: HTTP ${response.status}`);
  }
  return (await response.json()) as UploadResult;
}
