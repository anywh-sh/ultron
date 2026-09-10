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

/// Where a profile's tailnet node keeps the identity it earned when its
/// pre-auth key was spent. That key is single use and expires in 15 minutes
/// (anywh-control-plane's network/pairing.ts, journal/50 3.1), so this
/// directory surviving is the only thing that lets the profile rejoin the
/// tailnet later — losing it means re-pairing, not just a slower start.
/// Per profile: two profiles sharing one directory would fight over a
/// single node identity.
fn tailnet_state_dir(app: &tauri::AppHandle, profile_id: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("tailnet-state")
        .join(sanitize_for_path(profile_id));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Keeps a profile id usable as both a directory name and part of a tailnet
/// hostname — profile ids are generated locally (a UUID for an imported
/// profile, a slug for a hand-made one) and never validated against either
/// alphabet.
fn sanitize_for_path(profile_id: &str) -> String {
    let cleaned: String = profile_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c.to_ascii_lowercase() } else { '-' })
        .collect();
    if cleaned.is_empty() {
        "profile".to_string()
    } else {
        cleaned
    }
}

/// The name this device shows up as in the tenant's tailnet. Has to match
/// `node_id` byte-for-byte, no prefix or truncation: anywh-control-plane's
/// own hostname cross-check (`bindReportedNodeKey`/`reconcile.ts`,
/// journal/50 3.3) does a plain string comparison against `node.id`, not a
/// pattern match — a shortened/prefixed form (the previous
/// `ultron-<12 chars>`, live-confirmed via a WebdriverIO e2e run against
/// production) never matches and the device sits unbound forever. `node_id`
/// is `Profile.brokerNodeId` for a brokered profile, or `Profile.id` for a
/// manually configured one (no broker to reconcile against, so nothing to
/// match) — both are always a UUID already (`crypto.randomUUID()` on the JS
/// side), well inside the 63-character DNS label limit, so sanitizing here
/// is defense-in-depth against a malformed input, not an expected transform.
fn tailnet_hostname(node_id: &str) -> String {
    sanitize_for_path(node_id)
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

/// What a cold `tailnet_sidecar_start` resolves to — an already-running
/// sidecar's second (and later) caller gets `node_key: None`, since the
/// report (JS side, tailnetBroker.ts) only needs to happen once per join,
/// not once per caller.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TailnetUpResult {
    addr: String,
    node_key: Option<String>,
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
/// after the probe. `broker_node_id` (`Profile.brokerNodeId`, absent for a
/// manually configured profile) is what the tailnet hostname is set from —
/// see `tailnet_hostname`. A cold start also captures the `NODE_KEY` line
/// the Go side prints once `tsnet.Up()` returns, so the JS caller
/// (`tailnetSidecar.ts`) can report it to the control plane.
#[tauri::command]
pub async fn tailnet_sidecar_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, TailnetSidecars>,
    profile_id: String,
    auth_key: String,
    control_url: String,
    target: String,
    broker_node_id: Option<String>,
) -> Result<TailnetUpResult, String> {
    let mut running = state.0.lock().await;
    if let Some(existing) = running.get(&profile_id) {
        return Ok(TailnetUpResult { addr: existing.addr.clone(), node_key: None });
    }

    let state_dir = tailnet_state_dir(&app, &profile_id)?;
    let hostname_source = broker_node_id.as_deref().unwrap_or(&profile_id);
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
            "-state-dir",
            &state_dir.to_string_lossy(),
            "-hostname",
            &tailnet_hostname(hostname_source),
        ]);
    let (mut rx, child) = sidecar.spawn().map_err(|e| e.to_string())?;

    let mut listening: Option<String> = None;
    let mut node_key: Option<String> = None;
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                let line = String::from_utf8_lossy(&bytes);
                let line = line.trim();
                if let Some(addr) = line.strip_prefix("LISTENING ") {
                    listening = Some(addr.to_string());
                    break;
                }
                // Printed before LISTENING (Up() runs before Listen() on the
                // Go side) — captured, not broken on, so the loop still
                // exits on LISTENING as before.
                if let Some(key) = line.strip_prefix("NODE_KEY ") {
                    node_key = Some(key.to_string());
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
    Ok(TailnetUpResult { addr, node_key })
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


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hostname_matches_the_node_id_exactly() {
        // Byte-for-byte, not just "recognizable" — anywh-control-plane's own
        // cross-check does a plain string comparison, no prefix tolerance
        // (see this function's doc comment for the live bug this pins).
        let name = tailnet_hostname("77974f6e-e0ac-4d07-a0f0-0a8791c23e66");
        assert_eq!(name, "77974f6e-e0ac-4d07-a0f0-0a8791c23e66");
        assert!(name.len() <= 63);
        assert!(name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'));
    }

    #[test]
    fn hostname_survives_a_profile_id_that_is_not_a_uuid() {
        assert_eq!(tailnet_hostname("Trabalho Pessoal!"), "trabalho-pessoal-");
    }

    #[test]
    fn state_dir_segment_never_escapes_its_parent() {
        // A profile id is generated locally and never validated — it must not
        // be able to name a directory outside the app's own data dir.
        assert_eq!(sanitize_for_path("../../etc"), "------etc");
        assert!(!sanitize_for_path("../../etc").contains('.'));
    }
}
