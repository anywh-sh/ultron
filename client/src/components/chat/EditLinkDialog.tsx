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

/** Campos "texto" e "link" pra editar um hyperlink criado no composer via
 * paste-to-link. Não reaproveita `EmptyState`'s input pattern via
 * componente, só o mesmo estilo visual — cada um vive isolado no seu form. */
export function EditLinkDialog({ open, onOpenChange, initialText, initialHref, onSave }: EditLinkDialogProps) {
  const [text, setText] = useState(initialText);
  const [href, setHref] = useState(initialHref);

  useEffect(() => {
    if (!open) return;
    setText(initialText);
    setHref(initialHref);
  }, [open, initialText, initialHref]);

  function handleSubmit(event: FormEvent): void {
    // Precisa de `stopPropagation` além de `preventDefault`: o Dialog é
    // portalizado pro `document.body` no DOM, mas o React ainda propaga o
    // evento sintético pela árvore de COMPONENTES — sem isso, o submit
    // deste form "borbulha" até o <form> do Composer e envia a mensagem
    // (bug real, achado testando: editar um link disparava o envio).
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
