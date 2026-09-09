import { useState, type MouseEvent } from "react";

export interface ContextMenuState {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Fixed (viewport) position where the menu should anchor — follows the
   * cursor at the moment of the right-click, not the element's position. */
  position: { x: number; y: number };
  onContextMenu: (event: MouseEvent) => void;
}

/**
 * State for a menu anchored at the right-click point, instead of Radix's
 * default left-click — reuses the design system's `DropdownMenu`
 * (controlled via `open`/`onOpenChange` + an invisible trigger positioned
 * at the cursor) instead of bringing in Radix's `ContextMenu` primitive
 * just for this. Used by `SessionListItem` (left panel) and `TabBar` (tab).
 */
export function useContextMenu(): ContextMenuState {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  function onContextMenu(event: MouseEvent): void {
    event.preventDefault();
    // Stops a row's own menu (a file/folder in `FileTree`) from also
    // triggering an ancestor's menu (the file panel's background "new
    // file") — harmless for every other caller today, none of which nests
    // one of these inside another.
    event.stopPropagation();
    setPosition({ x: event.clientX, y: event.clientY });
    setOpen(true);
  }

  return { open, setOpen, position, onContextMenu };
}
