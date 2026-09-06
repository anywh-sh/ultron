use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::NativeChromeExt;
use crate::Result;

#[command]
pub(crate) async fn set_connection_indicator<R: Runtime>(
    app: AppHandle<R>,
    payload: ConnectionIndicatorRequest,
) -> Result<()> {
    app.native_chrome().set_connection_indicator(payload)
}

/// Native context menu (docs/33) — blocks (from this async command's point
/// of view) until the user picks an item or dismisses the menu; same
/// pattern as other Tauri plugins that wait on user interaction (e.g. the
/// `tauri-plugin-macos-permissions` permission dialog), doesn't impose any
/// timeout of its own.
#[command]
pub(crate) async fn show_context_menu<R: Runtime>(
    app: AppHandle<R>,
    payload: ShowContextMenuRequest,
) -> Result<ShowContextMenuResponse> {
    app.native_chrome().show_context_menu(payload)
}
