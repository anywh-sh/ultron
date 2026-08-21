import { useState, type MouseEvent } from "react";

export interface ContextMenuState {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Posição fixa (viewport) onde o menu deve ancorar — segue o cursor no
   * momento do clique direito, não a posição do elemento. */
  position: { x: number; y: number };
  onContextMenu: (event: MouseEvent) => void;
}

/**
 * Estado de um menu ancorado no ponto do clique direito, em vez do clique
 * esquerdo padrão do Radix — reaproveita o `DropdownMenu` do design system
 * (controlado via `open`/`onOpenChange` + um trigger invisível posicionado
 * no cursor) em vez de trazer o primitivo `ContextMenu` do Radix só pra
 * isso. Usado por `SessionListItem` (painel esquerdo) e `TabBar` (aba).
 */
export function useContextMenu(): ContextMenuState {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  function onContextMenu(event: MouseEvent): void {
    event.preventDefault();
    setPosition({ x: event.clientX, y: event.clientY });
    setOpen(true);
  }

  return { open, setOpen, position, onContextMenu };
}
