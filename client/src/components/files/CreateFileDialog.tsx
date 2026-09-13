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

interface CreateFileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (name: string) => void;
}

/** New file dialog, opened from the file tree's panel-level (background)
 * context menu — same shape as `RenameFileDialog`, kept separate since one
 * creates and the other renames an existing entry (different relay
 * endpoints, different validation: this one also has to reject an empty
 * name, `renameFile`'s never starts out empty). */
export function CreateFileDialog({ open, onOpenChange, onSave }: CreateFileDialogProps) {
  const dict = useDict();
  const copy = dict.panels.files.tree.newFile;
  const [name, setName] = useState("");

  useEffect(() => {
    if (open) setName("");
  }, [open]);

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
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={copy.placeholder}
              autoFocus
            />
          </DialogBody>
          <DialogFooter>
            <Button type="submit" size="sm">
              {dict.common.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
