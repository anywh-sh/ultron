//! journal/62 F2: the real Tauri↔sidecar bridge — supersedes the spike
//! probes (`tailnet_sidecar_probe`/`tailnet_sidecar_probe_listen`, both
//! already validated the exact spawn/stdout mechanics used here and are
//! gone now that the real thing exists). The sidecar itself stays ignorant
//! of the control plane's API the whole time (CT-1): these commands only
//! ever pass it Ed25519/tsnet primitives — a file path, a method/path/body
//! to sign, an auth key/control URL/target to join a tailnet with — never a
//! header name, a route, or anything that would make this module (or the
//! Go binary it spawns) know it's talking to anywh specifically.

use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex;

/// One running `tailnet-up` child per profile, keyed by `Profile.id` — tabs
/// sharing the same profile share the same tailnet join and local port
/// instead of each opening a redundant one (the ephemeral `-listen
/// 127.0.0.1:0` port exists to avoid collision *between different
/// profiles*, journal/62 CT-2, not between tabs of the same one). A single
/// `tokio::sync::Mutex` held for the whole start-or-join operation (not
/// just the map access) also means two tabs racing to open the same
/// profile at once can't both win and spawn two sidecars for it — the
/// second one simply finds the first's entry once it gets the lock.
#[derive(Default)]
pub struct TailnetSidecars(Mutex<HashMap<String, Running>>);

struct Running {
    child: CommandChild,
    addr: String,
}

/// Where the device's Ed25519 identity file lives — same directory Tauri
/// already uses for other per-install state (`voice.rs`'s Whisper model),
/// not guaranteed to exist yet on a fresh install.
fn identity_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("tailnet-identity"))
}

/// Generates (or loads, if it already exists) the device's Ed25519 keypair
/// and returns its public key, base64 — the same shape `POST /v1/nodes` and
/// `POST /v1/nodes/claim` already expect on the control-plane side. The
/// private key never leaves the sidecar's file (journal/49 D7).
#[tauri::command]
pub async fn tailnet_sidecar_identity(app: tauri::AppHandle) -> Result<String, String> {
    let path = identity_path(&app)?;
    let sidecar = app
        .shell()
        .sidecar("tailnet-sidecar")
        .map_err(|e| e.to_string())?
        .args(["identity", "-path", &path.to_string_lossy()]);
    let output = sidecar.output().await.map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[derive(Serialize, Deserialize)]
pub struct SignResult {
    ts: i64,
    sig: String,
}

/// Signs an HTTP request's method/path/body with the device identity, in
/// the exact format `anywh-control-plane`'s `nodeSignature.ts` expects.
/// Generic on purpose (CT-1): this command has no idea what the path means
/// or what will be done with the signature — whoever calls it from JS is
/// the one that knows it's building a request against a specific broker.
#[tauri::command]
pub async fn tailnet_sidecar_sign(
    app: tauri::AppHandle,
    method: String,
    path: String,
    body: String,
) -> Result<SignResult, String> {
    let identity = identity_path(&app)?;
    let sidecar = app
        .shell()
        .sidecar("tailnet-sidecar")
        .map_err(|e| e.to_string())?
        .args([
            "sign",
            "-identity",
            &identity.to_string_lossy(),
            "-method",
            &method,
            "-path",
            &path,
            "-body",
            &body,
        ]);
    let output = sidecar.output().await.map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())
}

/// Starts (or joins an already-running) `tailnet-up` for `profile_id` and
/// returns its local listen address (`host:port`) once the sidecar's
/// stdout confirms it's up — same `LISTENING host:port` line and
/// `CommandEvent::Stdout` read loop the spike (journal/62 step 4) already
/// validated, now keeping the child alive instead of killing it right
/// after the probe.
#[tauri::command]
pub async fn tailnet_sidecar_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, TailnetSidecars>,
    profile_id: String,
    auth_key: String,
    control_url: String,
    target: String,
) -> Result<String, String> {
    let mut running = state.0.lock().await;
    if let Some(existing) = running.get(&profile_id) {
        return Ok(existing.addr.clone());
    }

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

    let mut listening: Option<String> = None;
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                let line = String::from_utf8_lossy(&bytes);
                if let Some(addr) = line.trim().strip_prefix("LISTENING ") {
                    listening = Some(addr.to_string());
                    break;
                }
            }
            // Everything the Go side has to say goes to stderr (tsnet join
            // progress on the way up, then every dial it makes into the
            // tailnet). Discarding it made a sidecar that came up but can't
            // reach its target indistinguishable from one that works — the
            // only observable difference is a chat socket that never opens.
            CommandEvent::Stderr(bytes) => log_sidecar(&profile_id, &bytes),
            CommandEvent::Error(err) => return Err(err),
            CommandEvent::Terminated(payload) => {
                return Err(format!("tailnet-sidecar exited before printing LISTENING: {payload:?}"));
            }
            _ => {}
        }
    }
    let Some(addr) = listening else {
        return Err("tailnet-sidecar stdout closed without a LISTENING line".to_string());
    };

    running.insert(profile_id.clone(), Running { child, addr: addr.clone() });
    // The child outlives this command, so someone has to keep reading its
    // output — an unread channel would both lose the log above and, once
    // full, block the sidecar on its own writes.
    drop(running);
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => log_sidecar(&profile_id, &bytes),
                CommandEvent::Terminated(payload) => {
                    eprintln!("[tailnet-sidecar] {profile_id} exited: {payload:?}");
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(addr)
}

fn log_sidecar(profile_id: &str, bytes: &[u8]) {
    let line = String::from_utf8_lossy(bytes);
    let line = line.trim_end();
    if !line.is_empty() {
        eprintln!("[tailnet-sidecar] {profile_id}: {line}");
    }
}

/// Kills the `tailnet-up` child for `profile_id`, if any — a no-op if it
/// was never started or already stopped. The JS side (`tailnetSidecar.ts`)
/// only calls this once every tab using that profile has released it.
#[tauri::command]
pub async fn tailnet_sidecar_stop(
    state: tauri::State<'_, TailnetSidecars>,
    profile_id: String,
) -> Result<(), String> {
    let mut running = state.0.lock().await;
    if let Some(entry) = running.remove(&profile_id) {
        entry.child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}
