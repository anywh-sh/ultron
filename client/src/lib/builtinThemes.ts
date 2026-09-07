import type { Theme } from "@/lib/theme";

/**
 * Themes that ship with the app. They live here, not in the host's theme
 * registry, because they have to exist with the relay unreachable, with a
 * relay too old to know about themes, and on the very first launch before
 * any sync has happened.
 *
 * `default` mirrors the `:root` block in index.css — that block is what
 * paints the first frame (before any JS runs) and the fallback for every
 * token a custom theme leaves out, so the two have to agree. When a token
 * changes, change it in both.
 */
export const DEFAULT_THEME: Theme = {
  version: 1,
  id: "default",
  name: "Padrão",
  appearance: "dark",
  colors: {
    background: "#262624",
    "bg-sidebar": "#1f1e1c",
    "bg-elevated": "#2b2a27",
    card: "#302f2b",
    "bubble-user": "#35332e",

    foreground: "#f0eee6",
    "muted-foreground": "#a39c8e",
    "text-faint": "#6f6a5f",

    primary: "#d97757",
    destructive: "#c06456",
    "context-ring-warn": "#d9a441",
    "diff-add": "#9cae7c",

    border: "#3a382f",
    "border-soft": "#302f2a",

    overlay: "rgb(0 0 0 / 0.5)",
    "glass-tint": "#f0eee6",
    "media-scrim": "rgb(0 0 0 / 0.6)",
    "media-scrim-foreground": "#ffffff",
    "shadow-color": "rgb(0 0 0 / 0.65)",

    "syntax-comment": "#6f6a5f",
    "syntax-keyword": "#d97757",
    "syntax-string": "#9cae7c",
    "syntax-number": "#7c93ab",
    "syntax-title": "#f0eee6",

    "profile-1": "#d97757",
    "profile-2": "#7c93ab",
    "profile-3": "#8fa876",
    "profile-4": "#b08bbb",
    "profile-5": "#c9a45f",
    "profile-6": "#6fa3a3",
  },
  // Mirrors what TerminalView.tsx used to hardcode. `background` is
  // deliberately `--bg-sidebar` and not `--background`: the terminal paints
  // the same solid color as the panel it sits in, because chasing real
  // transparency through xterm's canvas + WebGL addon never closed fully
  // (see TerminalView.tsx).
  terminal: {
    background: "#1f1e1c",
    foreground: "#f0eee6",
    cursor: "#d97757",
    cursorAccent: "#1f1e1c",
    selectionBackground: "rgba(217, 119, 87, 0.35)",
    black: "#1f1e1c",
    red: "#c06456",
    green: "#9cae7c",
    yellow: "#d9a441",
    blue: "#7c93ab",
    magenta: "#b48ead",
    cyan: "#8fbcbb",
    white: "#f0eee6",
    brightBlack: "#6f6a5f",
    brightRed: "#d98282",
    brightGreen: "#b3c69a",
    brightYellow: "#e6bb63",
    brightBlue: "#9db3c9",
    brightMagenta: "#c9b6d4",
    brightCyan: "#a8d3d1",
    brightWhite: "#ffffff",
  },
};

export const BUILTIN_THEMES: Theme[] = [DEFAULT_THEME];

export function isBuiltinTheme(id: string): boolean {
  return BUILTIN_THEMES.some((theme) => theme.id === id);
}
