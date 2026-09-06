import { platform } from "@tauri-apps/plugin-os";
import { inTauri } from "@/lib/tauri";

export function isMacOS(): boolean {
  return typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
}

/** iOS via `@tauri-apps/plugin-os` (official API, `window.__TAURI_OS_PLUGIN_INTERNALS__`)
 * instead of UA sniffing — WKWebView on iOS can report an ambiguous UA, so
 * `isMacOS()` isn't extended to cover this case (docs/23, Phase B). */
export function isIOS(): boolean {
  return inTauri() && platform() === "ios";
}

/** Shortcut label for the tooltip — "⌘K" on macOS, "Ctrl+K" on Windows/Linux. */
export function shortcutLabel(key: string): string {
  return isMacOS() ? `⌘${key}` : `Ctrl+${key}`;
}
