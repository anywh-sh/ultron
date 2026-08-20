import { useCallback, useState } from "react";
import { uploadImage } from "@/lib/imageUpload";
import type { Profile } from "@/lib/profiles";

export interface PendingImage {
  path: string;
  previewUrl: string;
}

export interface UseImageUploadResult {
  pending: PendingImage[];
  uploading: boolean;
  addFiles: (files: FileList | File[]) => Promise<void>;
  remove: (path: string) => void;
  /** Esvazia a lista sem revogar os object URLs — usado ao enviar, já que a
   * mensagem no log passa a ser dona dessas prévias. */
  clearWithoutRevoke: () => void;
}

export function useImageUpload(profile: Profile, onError: (message: string) => void): UseImageUploadResult {
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [uploading, setUploading] = useState(false);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
      if (imageFiles.length === 0) return;

      setUploading(true);
      try {
        for (const file of imageFiles) {
          try {
            const path = await uploadImage(profile, file);
            setPending((prev) => [...prev, { path, previewUrl: URL.createObjectURL(file) }]);
          } catch (error) {
            onError(`Falha ao enviar imagem: ${error instanceof Error ? error.message : String(error)}`);
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
      const target = prev.find((img) => img.path === path);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((img) => img.path !== path);
    });
  }, []);

  const clearWithoutRevoke = useCallback(() => setPending([]), []);

  return { pending, uploading, addFiles, remove, clearWithoutRevoke };
}
