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
  /** Opcional: só a TabBar passa isso hoje (a SessionList já tem um botão
   * de lápis dedicado pro rename, não precisa duplicar no menu). */
  onRename?: () => void;
}

/** Trigger invisível ancorado no cursor (ver useContextMenu). Reaproveitado
 * pela SessionList (painel esquerdo) e pela TabBar (aba), os dois lugares
 * onde o botão direito abre esse menu.
 *
 * A confirmação usa um AlertDialog do design system em vez de
 * `window.confirm` — o diálogo nativo do WebView não é confiável em todas as
 * plataformas (mesma classe de problema documentada no backlog pra
 * alert/confirm no macOS), então a exclusão silenciosamente não acontecia. */
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
