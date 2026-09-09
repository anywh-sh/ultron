import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface RenameFileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName: string;
  onSave: (name: string) => void;
}

/** File rename dialog, opened from `FileEntryMenu`'s context menu — same
 * shape as `RenameSessionDialog`, kept separate because the two rename very
 * different things (a session title vs. a bare filename) with different
 * validation (no `/`, since the relay only allows renaming within the same
 * directory — `relay/src/fsFiles.ts`). */
export function RenameFileDialog({ open, onOpenChange, initialName, onSave }: RenameFileDialogProps) {
  const [name, setName] = useState(initialName);

  useEffect(() => {
    if (open) setName(initialName);
  }, [open, initialName]);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed.includes("/")) return;
    onSave(trimmed);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Renomear arquivo</DialogTitle>
          <DialogDescription>Escolha um novo nome pra esse arquivo, sem mudar de pasta.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-ring"
            autoFocus
          />
          <DialogFooter>
            <Button type="submit" size="sm">
              Renomear
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
