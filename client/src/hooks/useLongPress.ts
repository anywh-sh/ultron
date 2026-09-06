import { useRef, type TouchEvent } from "react";

interface UseLongPressOptions {
  delay?: number;
  onLongPress: (point: { x: number; y: number }) => void;
}

export interface LongPressHandlers {
  onTouchStart: (event: TouchEvent) => void;
  onTouchMove: () => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
}

/**
 * Long-press to open the native context menu on iOS (docs/33) — not the
 * same pattern as `useContextMenu` (that one is a right-click opening
 * Radix's `DropdownMenu`, desktop-only). Cancels on `touchmove` (scrolling
 * the list shouldn't trigger the menu) and on any `touchend`/`touchcancel`
 * before the delay — only fires if the finger stays still the whole time,
 * same as the system's native long-press.
 */
export function useLongPress({ delay = 500, onLongPress }: UseLongPressOptions): LongPressHandlers {
  const timerRef = useRef<number | undefined>(undefined);

  function clear(): void {
    window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
  }

  return {
    onTouchStart: (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      const point = { x: touch.clientX, y: touch.clientY };
      clear();
      timerRef.current = window.setTimeout(() => onLongPress(point), delay);
    },
    onTouchMove: clear,
    onTouchEnd: clear,
    onTouchCancel: clear,
  };
}
