import { invoke } from "@tauri-apps/api/core";

/** Item de menu nativo iOS (docs/33) — `systemIcon` é o nome de um SF
 * Symbol (ex: `"doc.on.doc"`, `"pencil"`), renderizado pelo próprio UIKit no
 * lado Swift. `disabledReason` vira a `subtitle` da `UIAction` quando
 * `disabled` — usado pelo botão de editar mensagem com imagem (v1 não
 * suporta, ver docs/20-backlog.md). */
export interface NativeMenuItem {
  id: string;
  label: string;
  systemIcon?: string;
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * Menu de contexto nativo do iOS — `UIEditMenuInteraction` (API pública
 * desde iOS 16) apresentado no ponto do toque, mesmo estilo arredondado com
 * ícone+label do menu de seleção de texto do sistema. Escolhida em vez de
 * `UIContextMenuInteraction` porque essa só dispara via gesto próprio do
 * sistema (long-press automático); `UIEditMenuInteraction` tem
 * `presentEditMenu(with:)`, público e imperativo, que aceita um ponto
 * arbitrário — o que permite disparar a partir do long-press detectado em
 * JS (`useLongPress`) em vez de depender de um gesture recognizer nativo
 * anexado a um elemento DOM específico (impossível, o conteúdo é WebView).
 *
 * Resolve com o id do item tocado, ou `null` se o usuário descartou o menu
 * sem escolher nada. Implementado pelo plugin `tauri-plugin-native-chrome`
 * (ver `ios/Sources/NativeChromePlugin.swift`) — superfície genérica de
 * propósito, não específica de mensagem de chat: qualquer feature futura que
 * precise de menu nativo no iOS reaproveita o mesmo comando.
 */
export async function showNativeContextMenu(items: NativeMenuItem[], point: { x: number; y: number }): Promise<string | null> {
  const result = await invoke<{ selectedId: string | null }>("plugin:native-chrome|show_context_menu", { items, point });
  return result.selectedId;
}
