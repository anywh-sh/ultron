import { useCallback, useRef, useState } from "react";

export interface NavLocation {
  tabId: string | null;
}

/**
 * Pilha de navegação estilo browser: cada mudança de aba ativa (por ação do
 * usuário) empilha uma entrada, cortando qualquer "forward" que existisse.
 * `goBack`/`goForward` movem um ponteiro pela pilha sem empilhar nada —
 * `notifyLocationChanged` ignora a próxima chamada logo depois de um dos
 * dois (via `skipNextRef`), porque senão a própria restauração de aba viraria
 * uma entrada nova (docs/21). Desde docs/29 (abas gerais, sem separação por
 * perfil) a localização é só a aba — o perfil já está embutido nela.
 */
export function useNavigationHistory(): {
  notifyLocationChanged: (location: NavLocation) => void;
  goBack: () => NavLocation | null;
  goForward: () => NavLocation | null;
  canGoBack: boolean;
  canGoForward: boolean;
} {
  const stackRef = useRef<NavLocation[]>([]);
  const pointerRef = useRef(-1);
  const skipNextRef = useRef(false);
  const [, forceUpdate] = useState(0);

  const notifyLocationChanged = useCallback((location: NavLocation) => {
    if (skipNextRef.current) {
      skipNextRef.current = false;
      return;
    }
    const stack = stackRef.current;
    const pointer = pointerRef.current;
    const current = pointer >= 0 ? stack[pointer] : undefined;
    if (current && current.tabId === location.tabId) return;

    const truncated = stack.slice(0, pointer + 1);
    truncated.push(location);
    stackRef.current = truncated;
    pointerRef.current = truncated.length - 1;
    forceUpdate((n) => n + 1);
  }, []);

  const goBack = useCallback((): NavLocation | null => {
    if (pointerRef.current <= 0) return null;
    pointerRef.current -= 1;
    skipNextRef.current = true;
    forceUpdate((n) => n + 1);
    return stackRef.current[pointerRef.current];
  }, []);

  const goForward = useCallback((): NavLocation | null => {
    if (pointerRef.current >= stackRef.current.length - 1) return null;
    pointerRef.current += 1;
    skipNextRef.current = true;
    forceUpdate((n) => n + 1);
    return stackRef.current[pointerRef.current];
  }, []);

  return {
    notifyLocationChanged,
    goBack,
    goForward,
    canGoBack: pointerRef.current > 0,
    canGoForward: pointerRef.current < stackRef.current.length - 1,
  };
}
