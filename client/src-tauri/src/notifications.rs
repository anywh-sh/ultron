// No Windows, o tauri-plugin-notification derruba o handle do toast depois
// de mostrá-lo, então o clique nunca chega no lado JS — por isso essa
// notificação é implementada direto sobre tauri-winrt-notification lá,
// passando um ícone fixo (via `.icon()`, que não depende de AUMID
// registrado) e um `.on_activated()` que foca a janela. O app_id ainda segue
// o mesmo teste dev-vs-instalado que o plugin original fazia — ver
// `windows_toast::resolve_app_id` — porque criar o notifier com um AUMID não
// registrado (rodando via `tauri dev`) faz a notificação inteira sumir, não
// só o ícone. Nas outras plataformas seguimos usando o plugin normalmente.
//
// `session_id`/`profile_id` viajam junto só pra rotear o clique de volta pra
// aba certa (client/src/hooks/useNotificationClick.ts tem o detalhe de como
// cada plataforma entrega isso, e a limitação conhecida de reabertura a
// frio — app totalmente fechado quando o clique acontece).
#[cfg(target_os = "windows")]
#[derive(Clone, serde::Serialize)]
struct NotificationClickPayload {
    session_id: String,
    profile_id: String,
}

#[tauri::command]
pub fn notify_turn_complete(app: tauri::AppHandle, title: String, body: String, session_id: String, profile_id: String) {
    #[cfg(target_os = "windows")]
    windows_toast::show(app, title, body, session_id, profile_id);

    #[cfg(not(target_os = "windows"))]
    {
        use tauri_plugin_notification::NotificationExt;
        // `extra` é o que o `onAction` do lado JS lê pra saber qual sessão
        // rotear — só chega lá de fato no iOS (handler nativo do plugin); no
        // macOS/Linux desktop esse crate não tem hook de clique nenhum (ver
        // useNotificationClick.ts), então isso fica sem efeito prático aí,
        // mas não custa nada mandar mesmo assim.
        let _ = app
            .notification()
            .builder()
            .title(title)
            .body(body)
            .extra("sessionId", session_id)
            .extra("profileId", profile_id)
            .show();
    }
}

#[cfg(target_os = "windows")]
mod windows_toast {
    use super::NotificationClickPayload;
    use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager};
    use tauri_winrt_notification::{IconCrop, Toast};

    /// Mesmo teste que o tauri-plugin-notification original fazia (ver
    /// comentário no topo do arquivo), estendido pro `.exe` portátil (sem
    /// instalador): o AUMID de verdade do app só existe registrado (atalho no
    /// Start Menu, criado pelo instalador NSIS) numa instalação de verdade —
    /// `target/debug`|`target/release` (dev) e o `.exe` portátil rodando de
    /// qualquer outro lugar (não tem instalador, não tem atalho) caem no
    /// mesmo caso. Criar o notifier com um app_id não registrado faz `show()`
    /// falhar calado — não é só o ícone errado, a notificação inteira some.
    /// `POWERSHELL_APP_ID` é garantidamente registrado em qualquer Windows,
    /// então funciona em todos esses casos; o ícone customizado (`.icon()`
    /// abaixo) e o clique (`.on_activated()`) não dependem do app_id estar
    /// registrado — só o ícone *padrão* (sem override) depende.
    fn resolve_app_id(identifier: &str) -> String {
        let running_unpacked = tauri::utils::platform::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|dir| dir.to_path_buf()))
            .is_none_or(|dir| !is_nsis_install_dir(&dir));
        if running_unpacked {
            Toast::POWERSHELL_APP_ID.to_string()
        } else {
            identifier.to_string()
        }
    }

    /// `installMode: "currentUser"` (ver `tauri.conf.json`) sempre instala em
    /// `%LOCALAPPDATA%\ultron`; `perMachine` cairia em `%ProgramFiles%\ultron`
    /// — checar os dois cobre se algum dia o modo mudar. Só esses diretórios
    /// têm o atalho do Menu Iniciar com o AppUserModelID registrado de
    /// verdade (é o instalador NSIS quem cria).
    fn is_nsis_install_dir(dir: &std::path::Path) -> bool {
        if dir.file_name().and_then(|n| n.to_str()) != Some("ultron") {
            return false;
        }
        let Some(parent) = dir.parent() else {
            return false;
        };
        let parent = parent.to_string_lossy().to_lowercase();
        ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"]
            .into_iter()
            .filter_map(|var| std::env::var(var).ok())
            .any(|known| known.to_lowercase() == parent)
    }

    pub fn show(app: AppHandle, title: String, body: String, session_id: String, profile_id: String) {
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
                // Sem entrada no listener ainda (app reaberto do zero pelo
                // clique, não só desminimizado) — evento se perde, ver a
                // limitação de reabertura a frio documentada em
                // useNotificationClick.ts.
                let _ = app.emit(
                    "notification-clicked",
                    NotificationClickPayload {
                        session_id: session_id.clone(),
                        profile_id: profile_id.clone(),
                    },
                );
                Ok(())
            });
            let _ = toast.show();
        });
    }
}
