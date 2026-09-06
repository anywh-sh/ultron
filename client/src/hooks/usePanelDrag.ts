import { useCallback, useRef, useState } from "react";

/** Right panel resize drag — same mechanics as `useResizableSidebar.ts`,
 * just mirrored: the draggable edge sits on the panel's left, so moving the
 * mouse left should *increase* the width (inverted sign relative to the
 * left sidebar). The width itself doesn't live here — it comes from
 * outside (`useSessionPanels`, per-session state), this hook just
 * translates pointer events into `onChange` calls.
 */
export function usePanelDrag(width: number, onChange: (width: number) => void) {
  const [isDragging, setIsDragging] = useState(false);
  const draggingRef = useRef(false);

  const startDrag = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      draggingRef.current = true;
      setIsDragging(true);

      const startX = event.clientX;
      const startWidth = width;

      function onMove(moveEvent: PointerEvent): void {
        if (!draggingRef.current) return;
        onChange(startWidth - (moveEvent.clientX - startX));
      }

      function onUp(): void {
        draggingRef.current = false;
        setIsDragging(false);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [width, onChange],
  );

  return { isDragging, startDrag };
}
