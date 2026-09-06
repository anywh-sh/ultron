// Only used for native drag-and-drop (ChatPanel.tsx): files arriving via
// Tauri's `onDragDropEvent` are read from disk as raw bytes (`read_dropped_
// file` command), without the real MIME type the browser would give a
// `File` coming from an `<input type="file">` — needs to be inferred from
// the extension.
const EXTENSION_MIME_MAP: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  heic: "image/heic",
  heif: "image/heif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  webm: "video/webm",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
};

export function guessMimeFromExtension(filename: string): string {
  const ext = filename.includes(".") ? filename.split(".").pop()?.toLowerCase() : undefined;
  return (ext && EXTENSION_MIME_MAP[ext]) || "application/octet-stream";
}
