import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { onAction } from "@tauri-apps/plugin-notification";
import { inTauri } from "@/lib/tauri";

export interface NotificationClickPayload {
  sessionId: string;
  profileId: string;
}

/**
 * Roteia o clique numa notificação de turno concluído (`lib/notifications.ts`)
 * de volta pra aba/perfil certos — dois canais em paralelo, porque a captura
 * do clique em si é implementada de formas diferentes por plataforma:
 *
 * - Windows: `src-tauri/src/notifications.rs` implementa o toast na mão
 *   (`windows_toast`, plugin não repassa clique pro JS nesse SO — motivo já
 *   documentado ali) e emite o evento Tauri `notification-clicked` no
 *   `on_activated`.
 * - iOS: o `tauri-plugin-notification` já tem handler nativo
 *   (`NotificationHandler.swift`) que repassa o toque pro `onAction` do JS,
 *   lendo o payload `extra` que o Rust anexa na notificação (branch não-Windows
 *   de `notify_turn_complete`).
 * - macOS/Linux: o crate desse plugin (`tauri-plugin-notification` 2.3.3) usa
 *   `notify-rust` no desktop e **não tem nenhum hook de clique** implementado
 *   — nem emite evento Tauri, nem aciona `onAction`. Clicar na notificação aí
 *   só põe o app em foco (comportamento padrão do SO, fora do nosso
 *   controle), sem trocar de aba. Replicar o roteamento de verdade nessas
 *   plataformas exigiria um módulo nativo próprio, no mesmo espírito do que
 *   já existe pro Windows — não faz parte desta rodada.
 *
 * Limitação conhecida em qualquer plataforma: o listener só existe depois do
 * React montar. Se o app estiver totalmente fechado (não só minimizado/em
 * background) quando a notificação for clicada, o clique reabre o app mas o
 * payload chega cedo demais pra ser escutado — perde o roteamento e cai no
 * comportamento padrão (app abre na última aba, sem trocar). Cobre o caso
 * comum (app rodando, sem foco); não implementamos fila/replay pra reabertura
 * a frio.
 */
export function useNotificationClick(onClick: (payload: NotificationClickPayload) => void): void {
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;

  useEffect(() => {
    if (!inTauri()) return;

    const unlistenPromise = listen<NotificationClickPayload>("notification-clicked", (event) => {
      onClickRef.current(event.payload);
    });
    const actionListenerPromise = onAction((notification) => {
      const sessionId = notification.extra?.sessionId;
      const profileId = notification.extra?.profileId;
      if (typeof sessionId === "string" && typeof profileId === "string") {
        onClickRef.current({ sessionId, profileId });
      }
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
      void actionListenerPromise.then((listener) => listener.unregister());
    };
  }, []);
}
