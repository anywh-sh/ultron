import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ContextMenuState } from "@/hooks/useContextMenu";

interface SessionDeleteMenuProps {
  menu: ContextMenuState;
  title: string;
  onDelete: () => void;
  /** Optional: only TabGroupStrip passes this today (SessionList already has a
   * dedicated pencil button for rename, no need to duplicate it in the menu). */
  onRename?: () => void;
}

/** Invisible trigger anchored to the cursor (see useContextMenu). Reused by
 * SessionList (left panel) and TabGroupStrip (tab), the two places where a
 * right-click opens this menu.
 *
 * The confirmation uses a design-system AlertDialog instead of
 * `window.confirm` — the WebView's native dialog isn't reliable across all
 * platforms (same class of problem documented in the backlog for
 * alert/confirm on macOS), so deletion would silently not happen. */
export function SessionDeleteMenu({ menu, title, onDelete, onRename }: SessionDeleteMenuProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <DropdownMenu open={menu.open} onOpenChange={menu.setOpen}>
        <DropdownMenuTrigger asChild>
          <span className="pointer-events-none fixed" style={{ left: menu.position.x, top: menu.position.y }} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {onRename && (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                menu.setOpen(false);
                onRename();
              }}
            >
              <Pencil />
              Renomear sessão
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            variant="destructive"
            onSelect={(event) => {
              event.preventDefault();
              setConfirmOpen(true);
            }}
          >
            <Trash2 />
            Excluir sessão
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir sessão</AlertDialogTitle>
            <AlertDialogDescription>
              Excluir a sessão "{title}"? Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
