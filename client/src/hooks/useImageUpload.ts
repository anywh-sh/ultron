import { useCallback, useState } from "react";
import { uploadAttachment } from "@/lib/imageUpload";
import { captureVideoFrame } from "@/lib/videoPreview";
import type { Profile } from "@/lib/profiles";

export interface PendingAttachment {
  kind: "image" | "video";
  /** Imagem: caminho da própria imagem. Vídeo: caminho do vídeo original —
   * fica referenciado na mensagem além dos frames, caso o Claude precise
   * rodar ffmpeg/ffprobe nele via Bash pra algo mais específico. */
  path: string;
  /** Ausente só quando a prévia falha (ex.: vídeo com codec que o
   * `<video>` do navegador não decodifica) — UI cai pra um ícone genérico. */
  previewUrl?: string;
  /** Só vídeo: paths dos frames extraídos no relay, em ordem cronológica —
   * é isso (não o vídeo em si) que vira `[imagem anexada]` na mensagem, já
   * que o Claude só "vê" imagem via `Read`, não vídeo. */
  frames?: string[];
}

export interface UseImageUploadResult {
  pending: PendingAttachment[];
  uploading: boolean;
  addFiles: (files: FileList | File[]) => Promise<void>;
  remove: (path: string) => void;
  /** Esvazia a lista sem revogar os object URLs — usado ao enviar, já que a
   * mensagem no log passa a ser dona dessas prévias. */
  clearWithoutRevoke: () => void;
}

export function useImageUpload(profile: Profile, onError: (message: string) => void): UseImageUploadResult {
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const attachable = Array.from(files).filter(
        (file) => file.type.startsWith("image/") || file.type.startsWith("video/"),
      );
      if (attachable.length === 0) return;

      setUploading(true);
      try {
        for (const file of attachable) {
          const isVideo = file.type.startsWith("video/");
          try {
            let previewUrl: string | undefined;
            if (isVideo) {
              // Best-effort: se o navegador não decodificar o codec, a
              // prévia falha mas o upload/extração de frames no relay (que
              // usa ffmpeg, com suporte bem mais amplo) segue normalmente.
              try {
                previewUrl = await captureVideoFrame(file);
              } catch {
                previewUrl = undefined;
              }
            } else {
              previewUrl = URL.createObjectURL(file);
            }

            const result = await uploadAttachment(profile, file);
            setPending((prev) => [
              ...prev,
              isVideo
                ? { kind: "video" as const, path: result.path, previewUrl, frames: result.frames ?? [] }
                : { kind: "image" as const, path: result.path, previewUrl },
            ]);
          } catch (error) {
            onError(
              `Falha ao enviar ${isVideo ? "vídeo" : "imagem"}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      } finally {
        setUploading(false);
      }
    },
    [profile, onError],
  );

  const remove = useCallback((path: string) => {
    setPending((prev) => {
      const target = prev.find((item) => item.path === path);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.path !== path);
    });
  }, []);

  const clearWithoutRevoke = useCallback(() => setPending([]), []);

  return { pending, uploading, addFiles, remove, clearWithoutRevoke };
}
