import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useDict } from "@/i18n";
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
  const dict = useDict();
  const copy = dict.panels.files.tree.renameFile;
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
          <DialogTitle>{copy.title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogBody>
            <DialogDescription>{copy.description}</DialogDescription>
            <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </DialogBody>
          <DialogFooter>
            <Button type="submit" size="sm">
              {dict.common.rename}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
