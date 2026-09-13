import { useState } from "react";
import { Columns2, Pencil, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useDict } from "@/i18n";
import { ContextMenuAnchor, type ContextMenuState } from "@/hooks/useContextMenu";

interface SessionDeleteMenuProps {
  menu: ContextMenuState;
  title: string;
  onDelete: () => void;
  onRename: () => void;
  /** Optional: only TabGroupStrip passes this — one of the three ways to
   * split a tab into its own group (the other two: drag it to the content
   * area's edge, or `Ctrl+\`). No-op (and hidden) when the tab is already
   * alone in its group, same guard `splitTabToNewGroup` itself enforces. */
  onMoveToNewGroup?: () => void;
}

/** Invisible trigger anchored to the cursor (see useContextMenu). Reused by
 * SessionList (left panel) and TabGroupStrip (tab), the two places where a
 * right-click opens this menu.
 *
 * The confirmation uses a design-system AlertDialog instead of
 * `window.confirm` — the WebView's native dialog isn't reliable across all
 * platforms (same class of problem documented in the backlog for
 * alert/confirm on macOS), so deletion would silently not happen. */
export function SessionDeleteMenu({ menu, title, onDelete, onRename, onMoveToNewGroup }: SessionDeleteMenuProps) {
  const dict = useDict();
  const strings = dict.shell.sidebar.sessionMenu;
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <DropdownMenu open={menu.open} onOpenChange={menu.setOpen}>
        <ContextMenuAnchor position={menu.position} />
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              menu.setOpen(false);
              onRename();
            }}
          >
            <Pencil />
            {strings.rename}
          </DropdownMenuItem>
          {onMoveToNewGroup && (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                menu.setOpen(false);
                onMoveToNewGroup();
              }}
            >
              <Columns2 />
              {strings.moveToNewGroup}
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
            {strings.delete}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{strings.deleteTitle}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogBody>
            <AlertDialogDescription>{strings.deleteBody.replace("{title}", title)}</AlertDialogDescription>
          </AlertDialogBody>
          <AlertDialogFooter>
            <AlertDialogCancel>{dict.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete}>{dict.common.delete}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
