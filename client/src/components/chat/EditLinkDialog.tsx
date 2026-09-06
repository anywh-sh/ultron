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

interface EditLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialText: string;
  initialHref: string;
  onSave: (text: string, href: string) => void;
}

const FIELD_CLASS =
  "rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-ring";

/** "text" and "link" fields to edit a hyperlink created in the composer via
 * paste-to-link. Doesn't reuse `EmptyState`'s input pattern as a component,
 * just the same visual style — each one lives isolated in its own form. */
export function EditLinkDialog({ open, onOpenChange, initialText, initialHref, onSave }: EditLinkDialogProps) {
  const [text, setText] = useState(initialText);
  const [href, setHref] = useState(initialHref);

  useEffect(() => {
    if (!open) return;
    setText(initialText);
    setHref(initialHref);
  }, [open, initialText, initialHref]);

  function handleSubmit(event: FormEvent): void {
    // Needs `stopPropagation` in addition to `preventDefault`: the Dialog is
    // portaled to `document.body` in the DOM, but React still propagates the
    // synthetic event through the COMPONENT tree — without this, this form's
    // submit "bubbles" up to the Composer's <form> and sends the message
    // (real bug, found while testing: editing a link would trigger a send).
    event.preventDefault();
    event.stopPropagation();
    const trimmedText = text.trim();
    const trimmedHref = href.trim();
    if (!trimmedText || !trimmedHref) return;
    onSave(trimmedText, trimmedHref);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar link</DialogTitle>
          <DialogDescription>Altere o texto exibido ou o endereço do link.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-link-text" className="text-xs text-muted-foreground">
              Texto
            </label>
            <input
              id="edit-link-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              className={FIELD_CLASS}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-link-href" className="text-xs text-muted-foreground">
              Link
            </label>
            <input
              id="edit-link-href"
              value={href}
              onChange={(event) => setHref(event.target.value)}
              className={FIELD_CLASS}
            />
          </div>
          <DialogFooter>
            <Button type="submit" size="sm">
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
