import type { PhysicalPosition } from "@tauri-apps/api/dpi";

// Tauri's native `onDragDropEvent` (ChatPanel.tsx, FilesPanel.tsx) reports
// `position` in physical pixels, but `elementFromPoint`/`getBoundingClientRect`
// work in CSS/logical pixels — `window.devicePixelRatio` is the webview's own
// view of that same scale factor, so dividing by it avoids an extra async
// `getCurrentWindow().scaleFactor()` round trip per drag event.
export function physicalPositionToClientPoint(position: PhysicalPosition): { x: number; y: number } {
  return { x: position.x / window.devicePixelRatio, y: position.y / window.devicePixelRatio };
}
