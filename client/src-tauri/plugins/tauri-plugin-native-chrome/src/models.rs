use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionIndicatorRequest {
  pub connected: bool,
}

/// Item de menu de contexto nativo (docs/33) — `system_icon` é o nome de um
/// SF Symbol (ex: `"doc.on.doc"`, `"pencil"`), resolvido no lado Swift.
/// `disabled_reason` vira a `subtitle` da `UIAction` quando `disabled` —
/// usado pelo item de editar mensagem com imagem anexada (fora de escopo da
/// v1, ver docs/20-backlog.md).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextMenuItem {
  pub id: String,
  pub label: String,
  #[serde(default)]
  pub system_icon: Option<String>,
  #[serde(default)]
  pub disabled: bool,
  #[serde(default)]
  pub disabled_reason: Option<String>,
}

/// Coordenadas do toque que disparou o long-press (docs/33) — espaço da
/// própria WKWebView (pontos, não pixels de device), mesmo referencial que
/// `TouchEvent.clientX/clientY` já usa no lado JS.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextMenuPoint {
  pub x: f64,
  pub y: f64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShowContextMenuRequest {
  pub items: Vec<ContextMenuItem>,
  pub point: ContextMenuPoint,
}

/// `None` quando o usuário descarta o menu sem escolher nada (toque fora,
/// ou o próprio sistema fecha o menu).
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShowContextMenuResponse {
  pub selected_id: Option<String>,
}
