import type { MouseEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Handler for clicks on links inside the app: by default Tauri navigates the
 * webview itself to the href (replacing the whole app), instead of opening in the
 * system browser — always intercepts and delegates to the opener plugin.
 */
export function handleExternalLinkClick(event: MouseEvent<HTMLAnchorElement>, href: string): void {
  event.preventDefault();
  void openUrl(href);
}
