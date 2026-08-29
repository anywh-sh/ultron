import SwiftRs
import Tauri
import UIKit
import WebKit

/// Cápsula de conexão nativa da Fase E (docs/23) — retirada (docs/24): o
/// indicador de conexão agora é renderizado pelo React dentro da
/// `MobileTopBar`, e a cápsula solta duplicava/sobrepunha esse texto sem
/// nenhum contexto de sessão. Mecanismo de `invoke`/`trigger` provado aqui
/// continua válido pra uma futura promoção nativa de verdade (docs/24
/// registra o porquê: precisa de botões separados + zona de blur, não uma
/// cápsula única) — plugin fica registrado, só sem nenhuma view por
/// enquanto.
///
/// `showContextMenu` (docs/33) é a segunda funcionalidade real do plugin:
/// menu de contexto nativo pro long-press em mensagens do chat (Copiar/
/// Editar), via `UIEditMenuInteraction` — a única API pública do UIKit que
/// permite apresentar um menu no estilo nativo (mesmo visual do menu de
/// seleção de texto do sistema) a partir de um ponto arbitrário, de forma
/// IMPERATIVA (`presentEditMenu(with:)`). `UIContextMenuInteraction`, a
/// alternativa mais óbvia, foi descartada de propósito: ela só dispara via
/// gesto PRÓPRIO do sistema (long-press automático anexado à view), sem
/// nenhum método público pra acionar a apresentação a partir de um long-press
/// já detectado em JS — o que é obrigatório aqui, já que o conteúdo é
/// WebView, não view nativa.
///
/// NÃO VALIDADO EM DISPOSITIVO REAL ainda — feito a partir da API pública
/// documentada da Apple (iOS 16+), mas esta sessão de trabalho não tem acesso
/// a um Mac/iPhone físico. Validar via o fluxo do Mac remoto (docs/31) antes
/// de considerar a Fase de menu nativo do docs/33 concluída: posição do menu
/// (o `sourcePoint` usa o espaço de coordenadas da própria `WKWebView`, que
/// deveria bater com `TouchEvent.clientX/clientY` do lado JS, mas isso nunca
/// foi confirmado contra o dispositivo real), thread (todas as chamadas de
/// UIKit aqui são despachadas pra main queue por segurança, já que não é
/// documented se o bridge do Tauri já entrega `Invoke` na main thread), e o
/// caso de descartar o menu sem escolher nada (`willDismissMenuFor`).
class NativeChromePlugin: Plugin, UIEditMenuInteractionDelegate {
  private var editMenuInteraction: UIEditMenuInteraction?
  private var pendingItems: [ContextMenuItemArgs] = []
  private var pendingInvoke: Invoke?
  private var pendingResolved = false

  @objc public override func load(webview: WKWebView) {
    let interaction = UIEditMenuInteraction(delegate: self)
    webview.addInteraction(interaction)
    self.editMenuInteraction = interaction
  }

  @objc func showContextMenu(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ShowContextMenuArgs.self)
    DispatchQueue.main.async {
      // Um menu já pendente (long-press duplo antes do primeiro resolver) —
      // resolve ele como descartado antes de abrir o novo, pra nunca deixar
      // uma promise de JS pendurada pra sempre.
      self.resolvePending(with: nil)

      guard let interaction = self.editMenuInteraction else {
        invoke.resolve(ShowContextMenuResult(selectedId: nil))
        return
      }
      self.pendingItems = args.items
      self.pendingInvoke = invoke
      self.pendingResolved = false
      let point = CGPoint(x: args.point.x, y: args.point.y)
      interaction.presentEditMenu(with: UIEditMenuConfiguration(sourcePoint: point))
    }
  }

  private func resolvePending(with selectedId: String?) {
    guard !pendingResolved, let invoke = pendingInvoke else { return }
    pendingResolved = true
    pendingInvoke = nil
    invoke.resolve(ShowContextMenuResult(selectedId: selectedId))
  }

  func editMenuInteraction(
    _ interaction: UIEditMenuInteraction,
    menuFor configuration: UIEditMenuConfiguration,
    suggestedActions: [UIMenuElement]
  ) -> UIMenu? {
    let actions: [UIMenuElement] = pendingItems.map { item in
      var attributes: UIMenuElement.Attributes = []
      if item.disabled { attributes.insert(.disabled) }
      let action = UIAction(
        title: item.label,
        image: item.systemIcon.flatMap { UIImage(systemName: $0) },
        attributes: attributes,
        handler: { [weak self] _ in self?.resolvePending(with: item.id) }
      )
      if let reason = item.disabledReason {
        action.subtitle = reason
      }
      return action
    }
    return UIMenu(children: actions)
  }

  func editMenuInteraction(
    _ interaction: UIEditMenuInteraction,
    willDismissMenuFor configuration: UIEditMenuConfiguration,
    animator: (any UIEditMenuInteractionAnimating)?
  ) {
    // Fechou sem escolher nada (toque fora, swipe, Escape em teclado externo)
    // — se uma ação já tiver resolvido isso (`resolvePending` é idempotente
    // via `pendingResolved`), este chamado não faz nada.
    resolvePending(with: nil)
  }
}

private struct ContextMenuItemArgs: Decodable {
  let id: String
  let label: String
  let systemIcon: String?
  let disabled: Bool
  let disabledReason: String?
}

private struct ContextMenuPointArgs: Decodable {
  let x: Double
  let y: Double
}

private struct ShowContextMenuArgs: Decodable {
  let items: [ContextMenuItemArgs]
  let point: ContextMenuPointArgs
}

private struct ShowContextMenuResult: Encodable {
  let selectedId: String?
}

@_cdecl("init_plugin_native_chrome")
func initPlugin() -> Plugin {
  return NativeChromePlugin()
}
