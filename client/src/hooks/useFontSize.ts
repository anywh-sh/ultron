import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_FONT_SIZE,
  FONT_SIZE_STEP,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  readFontSize,
  subscribeFontSize,
  writeFontSize,
} from "@/lib/fontSize";

export { DEFAULT_FONT_SIZE, FONT_SIZE_STEP, MAX_FONT_SIZE, MIN_FONT_SIZE };

/** Device-local app text size (px), configured in Settings — backed by
 * `@/lib/fontSize` (same `useSyncExternalStore` pattern as `useProfiles`). */
export function useFontSize(): { size: number; setSize: (next: number) => void } {
  const size = useSyncExternalStore(subscribeFontSize, readFontSize);
  const setSize = useCallback((next: number) => writeFontSize(next), []);
  return { size, setSize };
}
