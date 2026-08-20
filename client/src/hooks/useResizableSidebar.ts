import { useCallback, useRef, useState } from "react";

const MIN_WIDTH = 220;
const MAX_WIDTH = 420;
const DEFAULT_WIDTH = 280;

export interface ResizableSidebar {
  /** Largura efetiva em px — 0 quando colapsada, sem depender de regra CSS separada. */
  width: number;
  collapsed: boolean;
  isDragging: boolean;
  toggleCollapsed: () => void;
  startDrag: (event: React.PointerEvent) => void;
}

export function useResizableSidebar(): ResizableSidebar {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [collapsed, setCollapsed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const draggingRef = useRef(false);

  const startDrag = useCallback(
    (event: React.PointerEvent) => {
      if (collapsed) return;
      event.preventDefault();
      draggingRef.current = true;
      setIsDragging(true);

      const startX = event.clientX;
      const startWidth = width;

      function onMove(moveEvent: PointerEvent): void {
        if (!draggingRef.current) return;
        const next = startWidth + (moveEvent.clientX - startX);
        setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next)));
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
    [collapsed, width],
  );

  const toggleCollapsed = useCallback(() => setCollapsed((value) => !value), []);

  return { width: collapsed ? 0 : width, collapsed, isDragging, toggleCollapsed, startDrag };
}
