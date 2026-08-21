// No Windows, o tauri-plugin-notification só resolve o ícone de verdade via
// AUMID de um app instalado (com atalho registrado) — fora disso ele cai no
// ícone do PowerShell, que é o app_id de fallback do winrt-notification. O
// plugin também derruba o handle do toast depois de mostrá-lo, então o clique
// nunca chega no lado JS. Por isso essa notificação é implementada direto
// sobre tauri-winrt-notification no Windows: ícone fixo (não depende de
// instalação) e clique focando a janela. Nas outras plataformas seguimos
// usando o plugin normalmente.

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
    use tauri::{path::BaseDirectory, AppHandle, Manager};
    use tauri_winrt_notification::{IconCrop, Toast};

    pub fn show(app: AppHandle, title: String, body: String) {
        let icon = app
            .path()
            .resolve("icons/128x128.png", BaseDirectory::Resource)
            .ok()
            .filter(|path| path.exists());
        let app_id = app.config().identifier.clone();

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
