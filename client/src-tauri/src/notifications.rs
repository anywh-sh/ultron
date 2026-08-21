// No Windows, o tauri-plugin-notification derruba o handle do toast depois
// de mostrá-lo, então o clique nunca chega no lado JS — por isso essa
// notificação é implementada direto sobre tauri-winrt-notification lá,
// passando um ícone fixo (via `.icon()`, que não depende de AUMID
// registrado) e um `.on_activated()` que foca a janela. O app_id ainda segue
// o mesmo teste dev-vs-instalado que o plugin original fazia — ver
// `windows_toast::resolve_app_id` — porque criar o notifier com um AUMID não
// registrado (rodando via `tauri dev`) faz a notificação inteira sumir, não
// só o ícone. Nas outras plataformas seguimos usando o plugin normalmente.

#[tauri::command]
pub fn notify_turn_complete(app: tauri::AppHandle, title: String, body: String) {
    #[cfg(target_os = "windows")]
    windows_toast::show(app, title, body);

    #[cfg(not(target_os = "windows"))]
    {
        use tauri_plugin_notification::NotificationExt;
        let _ = app.notification().builder().title(title).body(body).show();
    }
}

#[cfg(target_os = "windows")]
mod windows_toast {
    use std::path::MAIN_SEPARATOR as SEP;
    use tauri::{path::BaseDirectory, AppHandle, Manager};
    use tauri_winrt_notification::{IconCrop, Toast};

    /// Mesmo teste que o tauri-plugin-notification original fazia (ver
    /// comentário no topo do arquivo): o AUMID de verdade do app só existe
    /// registrado (atalho no Start Menu) numa instalação de verdade. Rodando
    /// via `tauri dev`/exe solto em `target/debug`|`target/release`, criar o
    /// notifier com esse app_id não registrado faz `show()` falhar calado —
    /// não é só o ícone errado, a notificação inteira some. `POWERSHELL_APP_ID`
    /// é garantidamente registrado em qualquer Windows, então funciona nos
    /// dois casos; o ícone customizado (`.icon()` abaixo) e o clique
    /// (`.on_activated()`) não dependem do app_id estar registrado — só o
    /// ícone *padrão* (sem override) depende.
    fn resolve_app_id(identifier: &str) -> String {
        let running_unpacked = tauri::utils::platform::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|dir| dir.display().to_string()))
            .is_some_and(|dir| {
                dir.ends_with(&format!("{SEP}target{SEP}debug")) || dir.ends_with(&format!("{SEP}target{SEP}release"))
            });
        if running_unpacked {
            Toast::POWERSHELL_APP_ID.to_string()
        } else {
            identifier.to_string()
        }
    }

    pub fn show(app: AppHandle, title: String, body: String) {
        let icon = app
            .path()
            .resolve("icons/128x128.png", BaseDirectory::Resource)
            .ok()
            .filter(|path| path.exists());
        let app_id = resolve_app_id(&app.config().identifier);

        // notify e wait_for_action/on_activated bloqueiam a thread, então
        // isso não pode rodar na main thread do Tauri.
        std::thread::spawn(move || {
            let mut toast = Toast::new(&app_id).title(&title).text1(&body);
            if let Some(icon_path) = &icon {
                toast = toast.icon(icon_path, IconCrop::Square, &title);
            }
            let toast = toast.on_activated(move |_action| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                Ok(())
            });
            let _ = toast.show();
        });
    }
}
