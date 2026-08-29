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

/// Menu de contexto nativo (docs/33) — bloqueia (do ponto de vista deste
/// comando async) até o usuário escolher um item ou descartar o menu; mesmo
/// padrão de outros plugins Tauri que esperam interação do usuário (ex:
/// diálogo de permissão do `tauri-plugin-macos-permissions`), não impõe
/// timeout nenhum por conta própria.
#[command]
pub(crate) async fn show_context_menu<R: Runtime>(
    app: AppHandle<R>,
    payload: ShowContextMenuRequest,
) -> Result<ShowContextMenuResponse> {
    app.native_chrome().show_context_menu(payload)
}
