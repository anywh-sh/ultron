mod notifications;
// Windows-only fix for the blurry taskbar/Alt+Tab icon — see the module docs.
#[cfg(windows)]
mod window_icon;
// Voice (local dictation) out of scope for the iOS MVP (docs/22) —
// cpal/whisper-rs don't link on the iOS target without extra work. See
// Cargo.toml.
#[cfg(not(target_os = "ios"))]
mod voice;
// "Open in editor" (journal/60) needs a real filesystem/registry to detect
// installed editors against — out of scope for iOS the same way voice is.
#[cfg(not(target_os = "ios"))]
mod editors;
// tailnet-sidecar (journal/62): spawns an external Go process, which iOS
// can't do at all — same exclusion as voice/editors above.
#[cfg(not(target_os = "ios"))]
mod tailnet_sidecar;

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
    let builder = tauri::Builder::default();

    // Must come before every other plugin: the whole job of this one is to
    // make a redundant second process exit as early as possible, and a
    // plugin registered ahead of it would be one this doomed process paid
    // for anyway. On Windows and Linux that second process is how the OS
    // delivers an `anywh://` link to an app that's already running (it
    // passes the URL in argv rather than notifying the live instance), so
    // this is also what makes `onOpenUrl` fire on those two platforms
    // instead of only `getCurrent()` at a cold launch — see
    // src/hooks/useProfileImport.ts, which documented that gap as a known
    // limitation until now. The Cargo `deep-link` feature does the actual
    // forwarding into tauri-plugin-deep-link; the callback here only has to
    // surface the window that's about to receive it.
    #[cfg(not(target_os = "ios"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        use tauri::Manager as _;
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));

    let builder = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_deep_link::init());

    // tailnet-sidecar (journal/62) spawns an external process — not a
    // capability iOS has at all, same reasoning as the voice/editors
    // exclusions below.
    #[cfg(not(target_os = "ios"))]
    let builder = builder.plugin(tauri_plugin_shell::init());

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

    // e2e (client/tests/e2e, .anywh/skills/tests/SKILL.md) — embeds a
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
        .manage(tailnet_sidecar::TailnetSidecars::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            notifications::notify_turn_complete,
            voice::list_input_devices,
            voice::start_recording,
            voice::stop_recording_and_transcribe,
            read_dropped_file,
            editors::detect_editors,
            tailnet_sidecar::tailnet_sidecar_identity,
            tailnet_sidecar::tailnet_sidecar_sign,
            tailnet_sidecar::tailnet_sidecar_start,
            tailnet_sidecar::tailnet_sidecar_stop
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

            // The OS-level scheme registration (tauri.conf.json's
            // `plugins.deep-link.desktop.schemes`) only happens automatically
            // for a real installed/bundled build. In a debug run it doesn't —
            // Linux needs the manual `register_all` unconditionally (no
            // installer step at all in dev), Windows only in debug builds
            // (its release installer does the registration itself). macOS
            // registers from Info.plist at build time either way, so it's
            // deliberately excluded here.
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
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
