// On Windows, tauri-plugin-notification drops the toast handle right after
// showing it, so the click never reaches the JS side — that's why this
// notification is implemented directly on top of tauri-winrt-notification
// there, passing a fixed icon (via `.icon()`, which doesn't depend on a
// registered AUMID) and an `.on_activated()` that focuses the window. The
// app_id still follows the same dev-vs-installed check the original plugin
// did — see `windows_toast::resolve_app_id` — because creating the notifier
// with an unregistered AUMID (running via `tauri dev`) makes the whole
// notification disappear, not just the icon. On the other platforms we keep
// using the plugin normally.
//
// `session_id`/`profile_id` travel along just to route the click back to
// the right tab (client/src/hooks/useNotificationClick.ts has the detail of
// how each platform delivers that, and the known cold-reopen limitation —
// app fully closed when the click happens).
// `rename_all` is essential here: unlike `#[tauri::command]` args (the
// macro already converts to camelCase on its own on the JS bridge),
// `app.emit` serializes this payload with plain `serde::Serialize` — without
// the rename, `session_id`/`profile_id` (snake_case) would come out in the
// JSON, and the listener in useNotificationClick.ts (which expects
// `sessionId`/`profileId`) would get `undefined` for both fields, routing to
// a blank new tab instead of the right session (a real bug, found while
// testing on Windows).
#[cfg(target_os = "windows")]
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
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
        // `extra` is what `onAction` on the JS side reads to know which
        // session to route to — it only actually arrives there on iOS (the
        // plugin's native handler); on macOS/Linux desktop this crate has no
        // click hook at all (see useNotificationClick.ts), so this has no
        // practical effect there, but it doesn't hurt to send it anyway.
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

    /// Same check the original tauri-plugin-notification did (see the
    /// comment at the top of the file), extended to the portable `.exe`
    /// (no installer): the app's real AUMID only exists registered (Start
    /// Menu shortcut, created by the NSIS installer) in a real install —
    /// `target/debug`|`target/release` (dev) and the portable `.exe` running
    /// from anywhere else (no installer, no shortcut) fall into the same
    /// case. Creating the notifier with an unregistered app_id makes
    /// `show()` fail silently — it's not just the wrong icon, the whole
    /// notification disappears. `POWERSHELL_APP_ID` is guaranteed to be
    /// registered on any Windows install, so it works in all these cases;
    /// the custom icon (`.icon()` below) and the click (`.on_activated()`)
    /// don't depend on the app_id being registered — only the *default*
    /// icon (no override) does.
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

    /// `installMode: "currentUser"` (see `tauri.conf.json`) always installs
    /// into `%LOCALAPPDATA%\anywh`; `perMachine` would land in
    /// `%ProgramFiles%\anywh` — checking both covers the case where the
    /// mode ever changes. Only these directories have the Start Menu
    /// shortcut with the AppUserModelID actually registered (it's the NSIS
    /// installer that creates it).
    fn is_nsis_install_dir(dir: &std::path::Path) -> bool {
        if dir.file_name().and_then(|n| n.to_str()) != Some("anywh") {
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

        // notify and wait_for_action/on_activated block the thread, so this
        // can't run on Tauri's main thread.
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
                // No listener registered yet (app reopened from scratch by
                // the click, not just unminimized) — the event gets lost,
                // see the cold-reopen limitation documented in
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
