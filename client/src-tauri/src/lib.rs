mod notifications;
// Windows-only fix for the blurry taskbar/Alt+Tab icon — see the module docs.
#[cfg(windows)]
mod window_icon;
// Voice (local dictation) out of scope for the iOS MVP (docs/22) —
// cpal/whisper-rs don't link on the iOS target without extra work. See
// Cargo.toml.
#[cfg(not(target_os = "ios"))]
mod voice;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// Native drag-and-drop: Tauri's `onDragDropEvent` only delivers the file's
// path on disk, not the bytes — the frontend uses this command to read the
// file and reuse the same upload pipeline as the attach button (which
// starts from a browser `File`). `ipc::Response` returns the raw bytes to
// JS (ArrayBuffer), without the overhead of serializing an entire video as
// a JSON array of numbers.
#[tauri::command]
fn read_dropped_file(path: String) -> Result<tauri::ipc::Response, String> {
    std::fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());

    // cpal accesses CoreAudio directly (without going through AVFoundation),
    // which in practice doesn't trigger macOS's permission dialog — the app
    // captures only silence, with no error at all (whisper then
    // "hallucinates" something like "[Música]"). This plugin actually calls
    // AVCaptureDevice.requestAccess, which is the path macOS's TCC
    // recognizes.
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_plugin_macos_permissions::init());

    // Native chrome layer (SwiftUI/Liquid Glass) — docs/23, Phase E.
    #[cfg(target_os = "ios")]
    let builder = builder.plugin(tauri_plugin_native_chrome::init());

    // e2e (client/tests/e2e, .ultron/skills/tests/SKILL.md) — embeds a
    // WebDriver server inside the app itself so WebdriverIO's
    // @wdio/tauri-service can drive the real window/webview without an
    // external driver on any platform. Both crates are `optional` in
    // Cargo.toml, so they're not even compiled in unless this feature is
    // explicitly requested (`--features e2e`) — never present in a normal
    // `tauri dev`/`tauri build`.
    #[cfg(feature = "e2e")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    #[cfg(not(target_os = "ios"))]
    let builder = builder
        .manage(voice::VoiceState::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            notifications::notify_turn_complete,
            voice::list_input_devices,
            voice::start_recording,
            voice::stop_recording_and_transcribe,
            read_dropped_file
        ]);

    #[cfg(target_os = "ios")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        greet,
        notifications::notify_turn_complete
    ]);

    builder
        .setup(|app| {
            // On macOS, with hiddenTitle enabled (docs/21), the title configured in
            // tauri.conf.json sometimes doesn't reach the real NSWindow — the Dock menu
            // falls back to Tauri's internal default ("Tauri App"). Force the title explicitly.
            #[cfg(target_os = "macos")]
            if let Some(window) = tauri::Manager::get_webview_window(app, "main") {
                let _ = window.set_title("ultron");
            }

            #[cfg(windows)]
            if let Some(window) = tauri::Manager::get_webview_window(app, "main") {
                window_icon::apply(&window);

                // The icons are sized in physical pixels, so moving the window to a
                // monitor with another scale factor needs new ones.
                let scaled = window.clone();
                window.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::ScaleFactorChanged { .. }) {
                        window_icon::apply(&scaled);
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
