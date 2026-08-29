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
 * Long-press pra abrir o menu de contexto nativo no iOS (docs/33) — não é o
 * mesmo padrão de `useContextMenu` (esse é clique-direito abrindo o
 * `DropdownMenu` do Radix, exclusivo do desktop). Cancela no `touchmove`
 * (rolar a lista não deve disparar o menu) e em qualquer `touchend`/
 * `touchcancel` antes do delay — só dispara se o dedo ficar parado o tempo
 * todo, igual o long-press nativo do sistema.
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
