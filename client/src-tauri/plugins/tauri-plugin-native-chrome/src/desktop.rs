use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
  app: &AppHandle<R>,
  _api: PluginApi<R, C>,
) -> crate::Result<NativeChrome<R>> {
  Ok(NativeChrome(app.clone()))
}

/// Sem chrome nativo fora de iOS — no-op, o app real nunca depende deste
/// crate em desktop (Cargo.toml do app só inclui em cfg(target_os = "ios")).
pub struct NativeChrome<R: Runtime>(AppHandle<R>);

impl<R: Runtime> NativeChrome<R> {
  pub fn set_connection_indicator(&self, _payload: ConnectionIndicatorRequest) -> crate::Result<()> {
    Ok(())
  }

  /// Sem menu nativo fora de iOS — mesmo raciocínio de `set_connection_indicator`
  /// acima. `selected_id: None` (equivalente a "usuário descartou o menu") em
  /// vez de erro: o app real nunca chama isso fora de `isIOS()` (docs/33), mas
  /// devolver um resultado inofensivo é mais seguro que um erro genérico caso
  /// isso mude no futuro.
  pub fn show_context_menu(&self, _payload: ShowContextMenuRequest) -> crate::Result<ShowContextMenuResponse> {
    Ok(ShowContextMenuResponse { selected_id: None })
  }
}
