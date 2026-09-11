import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_FONT_SCALE,
  FONT_SCALE_STEP,
  MAX_FONT_SCALE,
  MIN_FONT_SCALE,
  readFontScale,
  subscribeFontScale,
  writeFontScale,
} from "@/lib/fontScale";

export { DEFAULT_FONT_SCALE, FONT_SCALE_STEP, MAX_FONT_SCALE, MIN_FONT_SCALE };

/** Device-local app-wide font scale, configured in Settings — backed by
 * `@/lib/fontScale` (same `useSyncExternalStore` pattern as `useProfiles`). */
export function useFontScale(): { scale: number; setScale: (next: number) => void } {
  const scale = useSyncExternalStore(subscribeFontScale, readFontScale);
  const setScale = useCallback((next: number) => writeFontScale(next), []);
  return { scale, setScale };
}
