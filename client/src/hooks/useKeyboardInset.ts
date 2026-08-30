import { useEffect, useRef, useState } from "react";
import { isIOS } from "@/lib/platform";

export interface KeyboardInsetInfo {
  /** Deslocamento (px) pra aplicar via `bottom` no composer flutuante — 0
   * quando o teclado está fechado, ou quando o próprio layout (`window.innerHeight`)
   * já encolheu sozinho pra acomodar o teclado (nesse caso o deslocamento
   * manual seria dobrado). */
  shift: number;
  /** Teclado aberto ou não — calculado de um jeito **independente** de
   * `shift`, comparando a altura atual do `visualViewport` contra a maior
   * altura já observada nesta sessão (a "altura de repouso", sem teclado).
   * Existe separado de `shift > 0` porque, se o layout encolhe junto com o
   * teclado (não confirmado se acontece no device físico — só validado no
   * Simulator, onde não encolhe), `shift` corretamente vai a zero (sem isso
   * dobraria o deslocamento), mas isso não pode significar "teclado
   * fechado" pra quem decide o padding-bottom (`ChatPanel.tsx`): nesse
   * cenário ainda precisa trocar o padding de safe-area-inset-bottom (pensado
   * pro home indicator, que deixa de existir com o teclado aberto) por um
   * valor fixo, senão sobra gap mesmo com `shift` zerado corretamente. */
  isOpen: boolean;
  /** Valores brutos só pra diagnóstico visual temporário
   * (`KeyboardDebugOverlay.tsx`) — remover junto quando o overlay sair. */
  debug: { vvHeight: number; winHeight: number; offsetTop: number; restingVvHeight: number };
}

const EMPTY: KeyboardInsetInfo = {
  shift: 0,
  isOpen: false,
  debug: { vvHeight: 0, winHeight: 0, offsetTop: 0, restingVvHeight: 0 },
};

/**
 * Info de teclado do iOS calculada via `visualViewport` — ver `docs/34` item
 * 1 (gap indevido entre composer e teclado) e `docs/39` (device físico
 * reproduziu o bug mesmo depois do fix validado só no Simulator — hipótese
 * de que o comportamento de `visualViewport`/layout difere entre os dois).
 */
export function useKeyboardInset(): KeyboardInsetInfo {
  const [info, setInfo] = useState<KeyboardInsetInfo>(EMPTY);
  const restingVvHeightRef = useRef(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!isIOS() || !vv) return;

    function update(): void {
      const vvHeight = vv!.height;
      const winHeight = window.innerHeight;
      const offsetTop = vv!.offsetTop;

      if (vvHeight > restingVvHeightRef.current) restingVvHeightRef.current = vvHeight;
      const restingVvHeight = restingVvHeightRef.current;

      const shift = Math.max(0, Math.round(winHeight - vvHeight - offsetTop));
      // Margem de 50px: reagir só a uma redução real (teclado), não a
      // pequenas variações (barra de endereço, rotação, etc.).
      const isOpen = restingVvHeight - vvHeight > 50;

      setInfo({ shift, isOpen, debug: { vvHeight, winHeight, offsetTop, restingVvHeight } });
    }

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return info;
}
