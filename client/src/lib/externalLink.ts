import type { MouseEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Handler pro click em link dentro do app: por padrão o Tauri navega a
 * própria webview pro href (substitui o app inteiro), em vez de abrir no
 * navegador do sistema — sempre intercepta e delega pro opener plugin.
 */
export function handleExternalLinkClick(event: MouseEvent<HTMLAnchorElement>, href: string): void {
  event.preventDefault();
  void openUrl(href);
}
