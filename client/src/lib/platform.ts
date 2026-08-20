export function isMacOS(): boolean {
  return typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
}

/** Rótulo de atalho pro tooltip — "⌘K" no macOS, "Ctrl+K" em Windows/Linux. */
export function shortcutLabel(key: string): string {
  return isMacOS() ? `⌘${key}` : `Ctrl+${key}`;
}
