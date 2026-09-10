//! journal/62 spike step 2: proves the tailnet-sidecar Go binary (built
//! from `client/tailnet-sidecar/`) works as a real Tauri sidecar
//! (`bundle.externalBin`) before any of the real identity/tailnet-up/sign
//! wiring (F2) exists. `tailnet_sidecar_probe` just spawns it with no
//! subcommand — the binary rejects that with a usage message on stderr and
//! exit code 2 — and returns that message, which is enough to prove
//! `externalBin` resolved the right binary and the shell plugin actually
//! executed it. Not gated behind `#[cfg(not(target_os = "ios"))]` itself —
//! that's done once at the call site in `lib.rs`, same as `editors.rs`: iOS
//! can't spawn an external process at all (journal/62 CT-2), so this
//! module doesn't compile there.

use tauri_plugin_shell::ShellExt;

#[tauri::command]
pub async fn tailnet_sidecar_probe(app: tauri::AppHandle) -> Result<String, String> {
    let sidecar = app
        .shell()
        .sidecar("tailnet-sidecar")
        .map_err(|e| e.to_string())?;
    let output = sidecar.output().await.map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&output.stderr).trim().to_string())
}
