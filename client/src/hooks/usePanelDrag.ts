import { useCallback, useRef, useState } from "react";

/** Arraste de redimensionamento do painel direito — mesma mecânica de
 * `useResizableSidebar.ts`, só que espelhada: a borda arrastável fica na
 * esquerda do painel, então mover o mouse pra esquerda deve *aumentar* a
 * largura (sinal invertido em relação à sidebar esquerda). A largura em si
 * não mora aqui — vem de fora (`useSessionPanels`, é estado por sessão),
 * este hook só traduz eventos de ponteiro em chamadas de `onChange`.
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
