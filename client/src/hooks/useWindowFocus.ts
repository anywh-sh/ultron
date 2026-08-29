import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { inTauri } from "@/lib/tauri";
import { isIOS } from "@/lib/platform";

/**
 * Foco da janela do SO — distinto de "aba ativa dentro do app". Usado pra
 * decidir se uma conversa está realmente visível pro usuário (troca de aba
 * no app + alt-tab pra outro app são os dois jeitos de "não estar olhando").
 * Fora do Tauri assume sempre focado (sem API pra checar, e não é o
 * contexto em que a notificação de turno concluído dispara mesmo).
 *
 * No iOS usa `document.visibilityState`/`visibilitychange` em vez da API de
 * foco de janela do Tauri — achado real (spike no Simulator, docs/37): o
 * foco de "janela" ali mapeia pro par `applicationWillResignActive`/
 * `DidBecomeActive` do UIKit, que dispara pra qualquer interrupção
 * momentânea (Control Center, um alerta do sistema, o próprio prompt nativo
 * de permissão de notificação) — não só quando o app sai de primeiro plano
 * de verdade. Resultado prático: notificação de turno concluído disparando
 * mesmo com o usuário olhando direto pra tela, porque `windowFocused`
 * piscava `false` num instante sem relação com background real. Já
 * `document.hidden` é a API padrão da web justamente para "a página está
 * genuinamente fora de vista", e só vira `true` na transição real de
 * background em WKWebView (confirmado no mesmo spike: dispara pouco antes
 * do processo ser suspenso, não em blips de foco). Desktop mantém a API de
 * janela do Tauri (ali "perder foco" É o sinal certo — alt-tab pra outro
 * app deve mesmo contar como "não estou olhando", diferente do iOS). */
export function useWindowFocus(): boolean {
  const [focused, setFocused] = useState(true);

  useEffect(() => {
    if (isIOS()) {
      setFocused(!document.hidden);
      const onVisibilityChange = () => setFocused(!document.hidden);
      document.addEventListener("visibilitychange", onVisibilityChange);
      return () => document.removeEventListener("visibilitychange", onVisibilityChange);
    }

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
