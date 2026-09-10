# Tauri Plugin native-chrome

Camada de chrome nativo do port iOS do anywh (docs/23, Fase E) — promovido do
spike de UI nativa (`docs/22`, spike 2/3: `manager.viewController` +
`UIHostingController` inserida como subview do webview via
`addChild`/`addSubview`, material Liquid Glass real do iOS 26).

Comando real: `setConnectionIndicator(connected: boolean)` — atualiza (não
recria) a mesma view SwiftUI, refletindo o estado de conexão do
`RelayClient` (`useRelayClient.ts` chama isso a cada `onConnectionChange`).
A view observa um `ConnectionIndicatorState` (`ObservableObject`) que o
comando só atualiza via `@Published` — é o mecanismo que faltava validar no
spike 2, que só criava a view uma vez e nunca mais mexia nela.

**Escopo deliberadamente limitado**: isto é só o mecanismo (view nativa
persistente + update via `invoke`), não o desenho final da UI mobile — onde
o indicador mora, tamanho/cor definitiva, comportamento em rotação de tela,
múltiplas views nativas simultâneas ficam para quando a sessão de design
dedicada (ver `docs/23`) começar.

## `showContextMenu` (docs/33)

Menu de contexto nativo pro long-press em mensagens do chat (Copiar/Editar),
via `UIEditMenuInteraction` (API pública desde iOS 16) — mesmo visual
arredondado do menu de seleção de texto do sistema, apresentado num ponto
arbitrário (`presentEditMenu(with:)`, imperativo, acionado a partir do
long-press detectado em JS via `useLongPress`). Superfície genérica de
propósito: qualquer feature futura que precise de menu nativo no iOS
reaproveita o mesmo comando, não é específico de mensagem de chat.

**Ainda não validado em dispositivo real** — escrito a partir da API pública
documentada da Apple, sem acesso a Mac/iPhone físico nesta sessão de
trabalho. Ver comentário no topo de `NativeChromePlugin.swift` pros pontos
específicos que precisam de confirmação (posição do menu, thread, descarte
sem escolha) antes de considerar essa parte do `docs/33` concluída — usar o
fluxo do Mac remoto (`docs/31`).
