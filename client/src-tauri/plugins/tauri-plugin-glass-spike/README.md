# Tauri Plugin glass-spike

Spike do port iOS (ver `docs/22-mobile-ios-investigacao.md`, spike 2), não é
uma feature do MVP ainda. Valida se dá pra compor UI nativa SwiftUI real
(Liquid Glass do iOS 26) ao lado do `WKWebView` que o Tauri usa no iOS: no
`load(webview:)`, pega `self.manager.viewController` e insere uma
`UIHostingController` como view filha via `addChild`/`addSubview`.

Resultado: funciona — confirmado rodando no Simulator, capsula com material
glass real renderizando sobre o conteúdo do webview sem crash. Fica no repo
como referência/scaffold pra quando a Fase 2 (UI nativa) começar de verdade;
não está ligado a nenhum comando real, só injeta a faixa de teste ao carregar.
