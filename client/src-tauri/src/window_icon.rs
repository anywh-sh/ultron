//! Windows-only: hand the shell correctly sized icons for the app window.
//!
//! Tauri's generated context turns `icons/icon.ico` into a *single* RGBA
//! buffer taken from the first directory entry (`entries()[0]` in
//! tauri-codegen's `image.rs`, upstream bug tauri-apps/tauri#14596). An .ico
//! is conventionally stored smallest-first, so that is our 16x16 art; tao
//! then builds one HICON out of it and assigns the same handle to both the
//! small and the big icon slot of the window. Everything the shell draws
//! bigger than that — the 24px taskbar button at 100% scaling, Alt+Tab — is
//! an upscale of 16x16 pixels, which is the blur reported on Windows (macOS
//! and iOS never go through this path, which is why only Windows looked bad).
//!
//! The .ico embedded into the executable as a Win32 resource is fine and
//! carries every size, so the fix is to ask Windows for the sizes it
//! actually draws (`LoadImageW` returns the exact matching entry when there
//! is one) and set those ourselves, the same thing Chromium/Electron do for
//! their windows — hence the crisp taskbar icons on Discord/Bruno.

use std::sync::Mutex;

use tauri::WebviewWindow;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{LPARAM, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi};
use windows::Win32::UI::WindowsAndMessaging::{
    DestroyIcon, LoadImageW, SendMessageW, HICON, ICON_BIG, ICON_SMALL, IMAGE_ICON,
    LR_DEFAULTCOLOR, SM_CXICON, SM_CXSMICON, SM_CYICON, SM_CYSMICON, SYSTEM_METRICS_INDEX,
    WM_SETICON,
};

/// Resource id `tauri-winres` embeds `icons/icon.ico` under (`IDI_APPLICATION`).
const ICON_RESOURCE_ID: u16 = 32512;

/// Default DPI (100% scaling), used when `GetDpiForWindow` can't answer.
const USER_DEFAULT_SCREEN_DPI: u32 = 96;

/// Icons we loaded and handed to the window. `LoadImageW` without `LR_SHARED`
/// returns handles we own, so the previous pair has to be destroyed whenever a
/// DPI change makes us load a new one.
static OWNED_ICONS: Mutex<Vec<isize>> = Mutex::new(Vec::new());

/// Sets the window's small/big icons from the executable's icon resource, at
/// the sizes Windows expects for the current DPI. Call again when the DPI
/// changes so the shell gets art rendered for the new scale factor.
pub fn apply(window: &WebviewWindow) {
    let hwnd = match window.hwnd() {
        Ok(hwnd) => hwnd,
        Err(err) => {
            eprintln!("[window_icon] failed to get the window handle: {err}");
            return;
        }
    };

    // Returns 0 for an invalid window handle, in which case 100% is as good a
    // guess as any — better a correctly sized icon for the wrong scale factor
    // than no icon at all.
    let dpi = match unsafe { GetDpiForWindow(hwnd) } {
        0 => USER_DEFAULT_SCREEN_DPI,
        dpi => dpi,
    };

    let small = load_icon(dpi, SM_CXSMICON, SM_CYSMICON);
    let big = load_icon(dpi, SM_CXICON, SM_CYICON);
    if small.is_none() && big.is_none() {
        eprintln!("[window_icon] no icon could be loaded from the executable resource");
        return;
    }

    let mut owned = OWNED_ICONS.lock().unwrap_or_else(|err| err.into_inner());
    let previous = std::mem::take(&mut *owned);

    for (icon, slot) in [(small, ICON_SMALL), (big, ICON_BIG)] {
        let Some(icon) = icon else { continue };
        unsafe {
            SendMessageW(
                hwnd,
                WM_SETICON,
                Some(WPARAM(slot as usize)),
                Some(LPARAM(icon.0 as isize)),
            );
        }
        owned.push(icon.0 as isize);
    }

    // Only after the window took the new ones — destroying an icon that is
    // still installed would leave the shell drawing a dangling handle.
    for icon in previous {
        unsafe {
            let _ = DestroyIcon(HICON(icon as *mut std::ffi::c_void));
        }
    }
}

/// Loads the app icon resource at the size `metric` resolves to for `dpi`.
/// `LoadImageW` picks the .ico entry matching that size exactly when it
/// exists, and only scales (down, from the next size up) when it doesn't.
fn load_icon(
    dpi: u32,
    width_metric: SYSTEM_METRICS_INDEX,
    height_metric: SYSTEM_METRICS_INDEX,
) -> Option<HICON> {
    let width = unsafe { GetSystemMetricsForDpi(width_metric, dpi) };
    let height = unsafe { GetSystemMetricsForDpi(height_metric, dpi) };

    let module = unsafe { GetModuleHandleW(PCWSTR::null()) }.ok()?;
    let handle = unsafe {
        LoadImageW(
            Some(module.into()),
            PCWSTR::from_raw(ICON_RESOURCE_ID as usize as *const u16),
            IMAGE_ICON,
            width,
            height,
            LR_DEFAULTCOLOR,
        )
    }
    .inspect_err(|err| eprintln!("[window_icon] LoadImageW({width}x{height}) failed: {err}"))
    .ok()?;

    Some(HICON(handle.0))
}
