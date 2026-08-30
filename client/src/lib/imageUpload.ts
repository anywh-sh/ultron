import type { Profile } from "@/lib/profiles";

export interface UploadResult {
  path: string;
  /** Só presente pra vídeo — paths dos frames extraídos no relay via
   * ffmpeg (ver `relay/src/uploads.ts`), em ordem cronológica. */
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
