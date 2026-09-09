//! Detects which local editors can receive an "open in editor" deep link
//! (journal/60). The signal that matters is **"the OS will route
//! `zed://...` somewhere"**, not "a `zed` binary exists on PATH" — the
//! feature never spawns the editor's CLI (see `client/src/lib/editorLinks.ts`
//! for why: the opener plugin only ever passes a single argument, and a
//! bare binary name breaks on macOS anyway), so PATH presence alone would be
//! both the wrong signal and, on Linux, an insufficient one (a `.desktop`
//! file is what actually makes the desktop environment honor the scheme).
//!
//! Not gated behind `#[cfg(not(target_os = "ios"))]` itself — that's done
//! once at the call site in `lib.rs`, the same cfg that already excludes
//! iOS from this whole family of desktop-only commands.

use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct EditorInfo {
    id: &'static str,
    label: &'static str,
}

/// `id` doubles as the URL scheme (`{id}://...`) — kept in sync with
/// `EditorId` in `client/src/lib/editorLinks.ts` by convention, not by a
/// shared type (Rust and TypeScript here are separate compilation units).
const EDITORS: &[(&str, &str)] = &[
    ("zed", "Zed"),
    ("vscode", "VS Code"),
    ("cursor", "Cursor"),
    ("windsurf", "Windsurf"),
];

#[tauri::command]
pub fn detect_editors() -> Vec<EditorInfo> {
    EDITORS
        .iter()
        .filter(|(id, _)| is_scheme_registered(id))
        .map(|(id, label)| EditorInfo { id, label })
        .collect()
}

#[cfg(target_os = "macos")]
fn is_scheme_registered(id: &str) -> bool {
    let bundle_name = match id {
        "zed" => "Zed.app",
        "vscode" => "Visual Studio Code.app",
        "cursor" => "Cursor.app",
        "windsurf" => "Windsurf.app",
        _ => return false,
    };
    let home = std::env::var("HOME").unwrap_or_default();
    [
        format!("/Applications/{bundle_name}"),
        format!("{home}/Applications/{bundle_name}"),
    ]
    .iter()
    .any(|path| std::path::Path::new(path).exists())
}

#[cfg(target_os = "linux")]
fn linux_binary_name(id: &str) -> &'static str {
    match id {
        "vscode" => "code",
        "cursor" => "cursor",
        "windsurf" => "windsurf",
        "zed" => "zed",
        _ => "",
    }
}

#[cfg(target_os = "linux")]
fn is_scheme_registered(id: &str) -> bool {
    let handler = format!("x-scheme-handler/{id}");
    let home = std::env::var("HOME").unwrap_or_default();
    let dirs = [
        format!("{home}/.local/share/applications"),
        "/usr/share/applications".to_string(),
    ];

    for dir in &dirs {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("desktop") {
                continue;
            }
            let Ok(contents) = std::fs::read_to_string(&path) else {
                continue;
            };
            // A `.desktop` file's `MimeType=` value is a `;`-separated list —
            // a substring match on the full line is enough to tell whether
            // this scheme is one of the entries, without a full ini parser.
            let registered = contents
                .lines()
                .any(|line| line.starts_with("MimeType=") && line.contains(&handler));
            if registered {
                return true;
            }
        }
    }

    // Fallback the plan explicitly allows: no desktop environments register
    // scheme handlers in a sandboxed/minimal setup, but a working `ssh` +
    // the binary itself is still enough for the user to have set the scheme
    // up by hand.
    let binary = linux_binary_name(id);
    !binary.is_empty()
        && std::env::var("PATH")
            .ok()
            .into_iter()
            .flat_map(|path_var| std::env::split_paths(&path_var).collect::<Vec<_>>())
            .any(|dir| dir.join(binary).exists())
}

/// `reg.exe query` rather than a raw `HKEY_CLASSES_ROOT` read via the
/// `windows` crate's Registry bindings — this is a read-only detection
/// check (not the "never call the editor's CLI" rule from journal/60, which
/// is about *opening* a file), and `reg.exe` is a stable, always-present
/// interface that doesn't require getting an unfamiliar FFI signature right
/// without a Windows toolchain to compile against.
#[cfg(target_os = "windows")]
fn is_scheme_registered(id: &str) -> bool {
    std::process::Command::new("reg")
        .args(["query", &format!("HKCR\\{id}")])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}
