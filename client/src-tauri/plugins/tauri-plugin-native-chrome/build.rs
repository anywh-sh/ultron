const COMMANDS: &[&str] = &["set_connection_indicator", "show_context_menu"];

fn main() {
  tauri_plugin::Builder::new(COMMANDS)
    .android_path("android")
    .ios_path("ios")
    .build();
}
