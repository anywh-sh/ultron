// Só usado pro drag-and-drop nativo (ChatPanel.tsx): arquivos que chegam via
// `onDragDropEvent` do Tauri são lidos do disco como bytes crus (comando
// `read_dropped_file`), sem o MIME real que o navegador daria a um `File`
// vindo de um `<input type="file">` — precisa ser inferido pela extensão.
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
