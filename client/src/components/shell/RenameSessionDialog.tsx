import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface RenameSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTitle: string;
  onSave: (title: string) => void;
}

/** Session rename dialog, opened by the edit icon that appears on hover
 * over a `SessionList` item — same visual pattern as `EditLinkDialog.tsx`,
 * each one isolated in its own form. */
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
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogBody>
            <DialogDescription>Escolha um novo nome pra essa conversa.</DialogDescription>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
          </DialogBody>
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
