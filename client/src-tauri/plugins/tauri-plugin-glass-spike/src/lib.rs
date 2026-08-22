use tauri::{
  plugin::{Builder, TauriPlugin},
  Manager, Runtime,
};

pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod commands;
mod error;
mod models;

pub use error::{Error, Result};

#[cfg(desktop)]
use desktop::GlassSpike;
#[cfg(mobile)]
use mobile::GlassSpike;

/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to access the glass-spike APIs.
pub trait GlassSpikeExt<R: Runtime> {
  fn glass_spike(&self) -> &GlassSpike<R>;
}

impl<R: Runtime, T: Manager<R>> crate::GlassSpikeExt<R> for T {
  fn glass_spike(&self) -> &GlassSpike<R> {
    self.state::<GlassSpike<R>>().inner()
  }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
  Builder::new("glass-spike")
    .invoke_handler(tauri::generate_handler![commands::ping])
    .setup(|app, api| {
      #[cfg(mobile)]
      let glass_spike = mobile::init(app, api)?;
      #[cfg(desktop)]
      let glass_spike = desktop::init(app, api)?;
      app.manage(glass_spike);
      Ok(())
    })
    .build()
}
