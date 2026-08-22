import SwiftRs
import SwiftUI
import Tauri
import UIKit
import WebKit

/// Estado observável compartilhado entre o comando (atualiza) e a view
/// SwiftUI (observa) — é o que faltava validar no spike 2 (docs/22/23,
/// Fase E): a view precisa persistir e receber updates via `invoke`, não só
/// ser criada uma vez em `load(webview:)` e esquecida.
/// `@unchecked Sendable` porque cruza pra dentro de um `Task { @MainActor in }`
/// ao ser atualizado pelo comando — sem isso o Swift 6 recusa compilar por
/// causa do strict concurrency checking. Não é `@MainActor` na classe (isso
/// exigiria que a inicialização do `state` em `NativeChromePlugin` também
/// rodasse isolada, o que não é garantido) — só a mutação em si é
/// empurrada pro main actor via `Task`, coerente com onde o SwiftUI observa.
final class ConnectionIndicatorState: ObservableObject, @unchecked Sendable {
  @Published var connected: Bool = false
}

@available(iOS 26.0, *)
struct ConnectionIndicatorView: View {
  @ObservedObject var state: ConnectionIndicatorState

  var body: some View {
    Text(state.connected ? "Conectado" : "Reconectando…")
      .font(.system(size: 15, weight: .semibold))
      .foregroundStyle(.primary)
      .padding(.horizontal, 16)
      .padding(.vertical, 10)
      .glassEffect()
  }
}

class SetConnectionIndicatorArgs: Decodable {
  let connected: Bool
}

class NativeChromePlugin: Plugin {
  private let state = ConnectionIndicatorState()

  @objc public override func load(webview: WKWebView) {
    guard #available(iOS 26.0, *) else { return }
    guard let viewController = self.manager.viewController else { return }

    let hosting = UIHostingController(rootView: ConnectionIndicatorView(state: state))
    hosting.view.backgroundColor = .clear
    hosting.view.translatesAutoresizingMaskIntoConstraints = false

    viewController.addChild(hosting)
    viewController.view.addSubview(hosting.view)
    hosting.didMove(toParent: viewController)

    NSLayoutConstraint.activate([
      hosting.view.topAnchor.constraint(
        equalTo: viewController.view.safeAreaLayoutGuide.topAnchor, constant: 8),
      hosting.view.centerXAnchor.constraint(equalTo: viewController.view.centerXAnchor),
    ])
  }

  @objc public func setConnectionIndicator(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SetConnectionIndicatorArgs.self)
    let connected = args.connected
    let indicatorState = state
    Task { @MainActor in
      indicatorState.connected = connected
    }
    invoke.resolve()
  }
}

@_cdecl("init_plugin_native_chrome")
func initPlugin() -> Plugin {
  return NativeChromePlugin()
}
