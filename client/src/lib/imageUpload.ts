import type { Profile } from "@/lib/profiles";

export async function uploadImage(profile: Profile, file: File): Promise<string> {
  const ext = file.name.includes(".") ? (file.name.split(".").pop() ?? "png") : "png";
  const buffer = await file.arrayBuffer();

  const response = await fetch(`http://${profile.host}:${profile.relayPort}/upload?ext=${encodeURIComponent(ext)}`, {
    method: "POST",
    body: buffer,
  });
  if (!response.ok) {
    throw new Error(`upload falhou: HTTP ${response.status}`);
  }
  const body = (await response.json()) as { path: string };
  return body.path;
}
