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
}
