import SwiftRs
import Tauri
import WebKit

/// Cápsula de conexão nativa da Fase E (docs/23) — retirada (docs/24): o
/// indicador de conexão agora é renderizado pelo React dentro da
/// `MobileTopBar`, e a cápsula solta duplicava/sobrepunha esse texto sem
/// nenhum contexto de sessão. Mecanismo de `invoke`/`trigger` provado aqui
/// continua válido pra uma futura promoção nativa de verdade (docs/24
/// registra o porquê: precisa de botões separados + zona de blur, não uma
/// cápsula única) — plugin fica registrado, só sem nenhuma view por
/// enquanto.
class NativeChromePlugin: Plugin {
  @objc public override func load(webview: WKWebView) {}
}

@_cdecl("init_plugin_native_chrome")
func initPlugin() -> Plugin {
  return NativeChromePlugin()
}
