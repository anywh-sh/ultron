mod notifications;
// Voz (ditado local) fora do escopo do MVP iOS (docs/22) — cpal/whisper-rs
// não linkam no target iOS sem trabalho adicional. Ver Cargo.toml.
#[cfg(not(target_os = "ios"))]
mod voice;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init());

    // cpal acessa o CoreAudio direto (sem passar pela AVFoundation), o que na
    // prática não dispara o diálogo de permissão do macOS — o app captura só
    // silêncio, sem erro nenhum (whisper então "alucina" tipo "[Música]").
    // Esse plugin chama AVCaptureDevice.requestAccess de verdade, que é o
    // caminho que o TCC do macOS reconhece.
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_plugin_macos_permissions::init());

    // Camada de chrome nativo (SwiftUI/Liquid Glass) — docs/23, Fase E.
    #[cfg(target_os = "ios")]
    let builder = builder.plugin(tauri_plugin_native_chrome::init());

    #[cfg(not(target_os = "ios"))]
    let builder = builder
        .manage(voice::VoiceState::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            notifications::notify_turn_complete,
            voice::list_input_devices,
            voice::start_recording,
            voice::stop_recording_and_transcribe
        ]);

    #[cfg(target_os = "ios")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        greet,
        notifications::notify_turn_complete
    ]);

    builder
        .setup(|app| {
            // No macOS, com hiddenTitle habilitado (docs/21), o título configurado em
            // tauri.conf.json às vezes não chega no NSWindow real — o menu do Dock cai
            // pro fallback interno do Tauri ("Tauri App"). Reforça o título explicitamente.
            #[cfg(target_os = "macos")]
            if let Some(window) = tauri::Manager::get_webview_window(app, "main") {
                let _ = window.set_title("ultron");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
