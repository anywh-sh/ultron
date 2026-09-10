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

use tauri_plugin_shell::process::CommandEvent;
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

/// journal/62 spike step 4: decides the local-port<->Rust transport by
/// actually using it, not just asserting it should work. `tailnet-up`
/// prints exactly one `LISTENING host:port` line to stdout once its local
/// listener is up (before it ever blocks on a tailnet connection) — this
/// reads `CommandEvent::Stdout` until that line shows up, same mechanism
/// the spike step 1 bash harness used, now exercised through the real
/// shell-plugin event stream instead of a shell pipe. The child is killed
/// right after: this is a probe for validating the transport, not the F2
/// wiring that would keep the sidecar alive for the app's actual lifetime.
#[tauri::command]
pub async fn tailnet_sidecar_probe_listen(
    app: tauri::AppHandle,
    auth_key: String,
    control_url: String,
    target: String,
) -> Result<String, String> {
    let sidecar = app
        .shell()
        .sidecar("tailnet-sidecar")
        .map_err(|e| e.to_string())?
        .args([
            "tailnet-up",
            "-auth-key",
            &auth_key,
            "-control-url",
            &control_url,
            "-target",
            &target,
            "-listen",
            "127.0.0.1:0",
        ]);
    let (mut rx, child) = sidecar.spawn().map_err(|e| e.to_string())?;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                let line = String::from_utf8_lossy(&bytes);
                if let Some(addr) = line.trim().strip_prefix("LISTENING ") {
                    let addr = addr.to_string();
                    let _ = child.kill();
                    return Ok(addr);
                }
            }
            CommandEvent::Error(err) => return Err(err),
            CommandEvent::Terminated(payload) => {
                return Err(format!("sidecar exited before printing LISTENING: {payload:?}"));
            }
            _ => {}
        }
    }
    Err("sidecar stdout closed without a LISTENING line".to_string())
}
