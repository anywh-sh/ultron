import { Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ContextMenuState } from "@/hooks/useContextMenu";

interface SessionDeleteMenuProps {
  menu: ContextMenuState;
  onDelete: () => void;
}

/** Trigger invisível ancorado no cursor (ver useContextMenu) — por enquanto
 * só tem uma opção: excluir a sessão. Reaproveitado pela SessionList (painel
 * esquerdo) e pela TabBar (aba), os dois lugares onde o botão direito abre
 * esse menu. */
export function SessionDeleteMenu({ menu, onDelete }: SessionDeleteMenuProps) {
  return (
    <DropdownMenu open={menu.open} onOpenChange={menu.setOpen}>
      <DropdownMenuTrigger asChild>
        <span className="pointer-events-none fixed" style={{ left: menu.position.x, top: menu.position.y }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 />
          Excluir sessão
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
