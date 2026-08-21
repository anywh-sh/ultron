import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface RenameSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTitle: string;
  onSave: (title: string) => void;
}

/** Dialog de renomear sessão, aberto pelo ícone de edição que aparece no
 * hover de um item da `SessionList` — mesmo padrão visual de
 * `EditLinkDialog.tsx`, cada um isolado no próprio form. */
export function RenameSessionDialog({ open, onOpenChange, initialTitle, onSave }: RenameSessionDialogProps) {
  const [title, setTitle] = useState(initialTitle);

  useEffect(() => {
    if (open) setTitle(initialTitle);
  }, [open, initialTitle]);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    onSave(trimmed);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Renomear sessão</DialogTitle>
          <DialogDescription>Escolha um novo nome pra essa conversa.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-ring"
            autoFocus
          />
          <DialogFooter>
            <Button type="submit" size="sm">
              Atualizar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
