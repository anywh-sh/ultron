import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { inTauri } from "@/lib/tauri";

/**
 * Foco da janela do SO — distinto de "aba ativa dentro do app". Usado pra
 * decidir se uma conversa está realmente visível pro usuário (troca de aba
 * no app + alt-tab pra outro app são os dois jeitos de "não estar olhando").
 * Fora do Tauri assume sempre focado (sem API pra checar, e não é o
 * contexto em que a notificação de turno concluído dispara mesmo).
 */
export function useWindowFocus(): boolean {
  const [focused, setFocused] = useState(true);

  useEffect(() => {
    if (!inTauri()) return;
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;

    void appWindow.isFocused().then(setFocused);
    void appWindow.onFocusChanged(({ payload }) => setFocused(payload)).then((fn) => {
      unlisten = fn;
    });

    return () => unlisten?.();
  }, []);

  return focused;
}
