# Tauri Plugin native-chrome

Camada de chrome nativo do port iOS do ultron (docs/23, Fase E) — promovido do
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
