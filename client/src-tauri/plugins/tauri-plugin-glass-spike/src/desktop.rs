use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
  app: &AppHandle<R>,
  _api: PluginApi<R, C>,
) -> crate::Result<GlassSpike<R>> {
  Ok(GlassSpike(app.clone()))
}

/// Access to the glass-spike APIs.
pub struct GlassSpike<R: Runtime>(AppHandle<R>);

impl<R: Runtime> GlassSpike<R> {
  pub fn ping(&self, payload: PingRequest) -> crate::Result<PingResponse> {
    Ok(PingResponse {
      value: payload.value,
    })
  }
}
