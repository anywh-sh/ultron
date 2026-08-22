import SwiftRs
import SwiftUI
import Tauri
import UIKit
import WebKit

class GlassSpikePlugin: Plugin {
  @objc public override func load(webview: WKWebView) {
    guard #available(iOS 26.0, *) else { return }
    guard let viewController = self.manager.viewController else { return }

    let glassView = Text("ultron — glass spike")
      .font(.system(size: 15, weight: .semibold))
      .foregroundStyle(.primary)
      .padding(.horizontal, 16)
      .padding(.vertical, 10)
      .glassEffect()

    let hosting = UIHostingController(rootView: glassView)
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
}

@_cdecl("init_plugin_glass_spike")
func initPlugin() -> Plugin {
  return GlassSpikePlugin()
}
