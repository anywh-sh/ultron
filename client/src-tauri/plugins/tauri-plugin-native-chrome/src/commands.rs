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
