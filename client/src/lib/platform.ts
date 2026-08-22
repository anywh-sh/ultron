import { platform } from "@tauri-apps/plugin-os";
import { inTauri } from "@/lib/tauri";

export function isMacOS(): boolean {
  return typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
}

/** iOS via `@tauri-apps/plugin-os` (API oficial, `window.__TAURI_OS_PLUGIN_INTERNALS__`)
 * em vez de sniffing de UA — WKWebView em iOS pode reportar UA ambíguo,
 * então não estende `isMacOS()` pra esse caso (docs/23, Fase B). */
export function isIOS(): boolean {
  return inTauri() && platform() === "ios";
}

/** Rótulo de atalho pro tooltip — "⌘K" no macOS, "Ctrl+K" em Windows/Linux. */
export function shortcutLabel(key: string): string {
  return isMacOS() ? `⌘${key}` : `Ctrl+${key}`;
}
