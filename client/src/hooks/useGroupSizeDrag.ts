import { useCallback, useRef, useState } from "react";

/** Floor for a group's width, in px — below this a chat column stops being
 * usable. Revisited once the dock (terminal/files pane) enters the picture:
 * a narrow group with the files pane open needs more than this alone (see
 * `useSessionDock.ts`'s `clampWidth`), but that's the dock's own problem to
 * solve against the group's available width, not this hook's. */
export const MIN_GROUP_PX = 480;

/**
 * Drag for a handle between two adjacent tab groups — sibling of
 * `usePanelDrag`/`useSplitDrag`, but working in fraction space (0..1) over
 * the whole `sizes` array instead of a single pixel value, and mutating the
 * container's CSS custom properties directly during the drag instead of
 * going through React state. That's what lets a resize run at zero React
 * renders per frame: the panel layer's `left`/`width` are `calc()`
 * expressions over `--g{i}-frac`/`--g{i}-cum`, so the browser recomputes
 * them on its own the instant the custom properties change, no re-render
 * needed until `onCommit` lands the final sizes on pointer up (same
 * drag-end-only persistence as `useSessionDock`'s dock resize).
 *
 * Only the two groups adjacent to the dragged handle ever change — sizes
 * before the handle keep their absolute values, and every cumulative sum
 * past the handle's right-hand group is unchanged too (what one group gives
 * up, its neighbor gains, so the running total past both is identical).
 */
export function useGroupSizeDrag(sizes: number[], containerRef: React.RefObject<HTMLElement | null>, onCommit: (sizes: number[]) => void) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const draggingRef = useRef(false);

  const startDrag = useCallback(
    (index: number) =>
      (event: React.PointerEvent) => {
        const container = containerRef.current;
        const containerWidth = container?.clientWidth ?? 0;
        if (!container || containerWidth === 0) return;
        // Rebound to a non-null local — TS doesn't carry the narrowing above
        // into the nested `onMove`/`onUp` closures below.
        const el = container;

        event.preventDefault();
        draggingRef.current = true;
        setDraggingIndex(index);

        const startX = event.clientX;
        const startSizeA = sizes[index];
        const startSizeB = sizes[index + 1];
        const cumBeforeA = sizes.slice(0, index).reduce((sum, size) => sum + size, 0);
        const minFraction = MIN_GROUP_PX / containerWidth;
        let nextSizeA = startSizeA;
        let nextSizeB = startSizeB;

        function onMove(moveEvent: PointerEvent): void {
          if (!draggingRef.current) return;
          const rawDelta = (moveEvent.clientX - startX) / containerWidth;
          const delta = Math.max(minFraction - startSizeA, Math.min(startSizeB - minFraction, rawDelta));
          nextSizeA = startSizeA + delta;
          nextSizeB = startSizeB - delta;
          el.style.setProperty(`--g${index}-frac`, String(nextSizeA));
          el.style.setProperty(`--g${index + 1}-frac`, String(nextSizeB));
          el.style.setProperty(`--g${index + 1}-cum`, String(cumBeforeA + nextSizeA));
        }

        function onUp(): void {
          draggingRef.current = false;
          setDraggingIndex(null);
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          onCommit(sizes.map((size, i) => (i === index ? nextSizeA : i === index + 1 ? nextSizeB : size)));
        }

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      },
    [sizes, containerRef, onCommit],
  );

  return { draggingIndex, startDrag };
}
