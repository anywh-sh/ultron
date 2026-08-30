import { useEffect, useState } from "react";
import { isIOS } from "@/lib/platform";

/**
 * Altura do teclado do iOS em px, calculada via `visualViewport` — 0 quando
 * fechado. Usado pra reposicionar o composer flutuante (`ChatPanel.tsx`)
 * acima do teclado de verdade, em vez de confiar só em `bottom-0` +
 * `env(safe-area-inset-bottom)`: o `visualViewport` encolhe quando o
 * teclado abre, mas não há garantia de que o layout (`window.innerHeight`,
 * de onde `100vh`/`h-screen` derivam) encolha junto no WKWebView — e mesmo
 * quando encolhe, `env(safe-area-inset-bottom)` continua contabilizando a
 * área do home indicator, que não existe mais (foi substituída pelo
 * teclado) nesse estado, sobrando como um gap indevido entre o composer e o
 * teclado (bug real reportado pelo usuário, docs/34 item 1). Cálculo
 * (`innerHeight - visualViewport.height - offsetTop`) é robusto aos dois
 * cenários possíveis (layout encolhe ou não junto com o teclado): se já
 * encolheu, o resultado tende a zero sozinho; se não encolheu, captura a
 * altura real do teclado pra deslocar o composer manualmente.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!isIOS() || !vv) return;

    function update(): void {
      const gap = window.innerHeight - vv!.height - vv!.offsetTop;
      setInset(Math.max(0, Math.round(gap)));
    }

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
