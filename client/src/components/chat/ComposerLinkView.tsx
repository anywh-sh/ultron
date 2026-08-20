import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getMarkRange, type Range } from "@tiptap/core";
import { MarkViewContent, type MarkViewProps } from "@tiptap/react";
import { Pencil } from "lucide-react";
import { EditLinkDialog } from "@/components/chat/EditLinkDialog";

const OPEN_DELAY_MS = 150;
const CLOSE_DELAY_MS = 150;

/** Mark view (Tiptap v3) do link criado por paste-to-link no composer —
 * troca cor do texto, mostra o href (truncado) + ícone de editar num painel
 * flutuante ao passar o mouse, e abre um Dialog pra editar texto/link.
 * Painel é posicionado à mão (getBoundingClientRect + portal), não via
 * Radix HoverCard: `MarkViewContent` não é forwardRef, então o anchor do
 * Popper do Radix nunca recebia o retângulo real do link (testado: abria
 * sempre em 0,0). Sem posição própria nas `MarkViewProps` (diferente de
 * node views) — a posição no doc pro editar é resolvida a partir do próprio
 * elemento DOM no hover, via `posAtDOM` + `getMarkRange`. */
export function ComposerLinkView({ mark, editor }: MarkViewProps) {
  const href = (mark.attrs.href as string) ?? "";
  const [cardOpen, setCardOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [currentText, setCurrentText] = useState("");
  const rangeRef = useRef<Range | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimer(): void {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  useEffect(() => clearTimer, []);

  function scheduleOpen(target: HTMLElement): void {
    clearTimer();
    timerRef.current = setTimeout(() => {
      const linkType = editor.schema.marks.link;
      const pos = editor.view.posAtDOM(target, 0, 1);
      const $pos = editor.state.doc.resolve(Math.min(pos + 1, editor.state.doc.content.size));
      const range = linkType ? (getMarkRange($pos, linkType) ?? null) : null;
      rangeRef.current = range;
      // Lido aqui, no exato doc em que `range` foi resolvido — nunca no
      // render (o doc pode já ter mudado e invalidado `range` nesse
      // meio-tempo, ex.: logo depois de salvar uma edição, `textBetween`
      // com um range de antes da edição explode contra o doc novo).
      setCurrentText(range ? editor.state.doc.textBetween(range.from, range.to) : "");
      setAnchorRect(target.getBoundingClientRect());
      setCardOpen(true);
    }, OPEN_DELAY_MS);
  }

  function scheduleClose(): void {
    clearTimer();
    timerRef.current = setTimeout(() => setCardOpen(false), CLOSE_DELAY_MS);
  }

  function handleSave(text: string, newHref: string): void {
    const range = rangeRef.current;
    if (!range) return;
    editor
      .chain()
      .focus()
      .insertContentAt(range, {
        type: "text",
        text,
        marks: [{ type: "link", attrs: { ...mark.attrs, href: newHref } }],
      })
      .run();
  }

  return (
    <>
      <MarkViewContent
        as="a"
        href={href}
        className="composer-link"
        onClick={(event) => event.preventDefault()}
        onMouseEnter={(event) => scheduleOpen(event.currentTarget)}
        onMouseLeave={scheduleClose}
      />

      {cardOpen &&
        anchorRect &&
        createPortal(
          <div
            role="tooltip"
            onMouseEnter={clearTimer}
            onMouseLeave={scheduleClose}
            style={{ position: "fixed", left: anchorRect.left, top: anchorRect.top - 8, transform: "translateY(-100%)" }}
            className="z-50 flex w-auto max-w-72 items-center gap-1.5 rounded-md border border-border bg-popover px-2.5 py-1.5 text-popover-foreground shadow-md"
          >
            <span className="max-w-56 truncate font-mono text-xs text-muted-foreground">{href}</span>
            <button
              type="button"
              onClick={() => {
                setCardOpen(false);
                setDialogOpen(true);
              }}
              aria-label="Editar link"
              className="flex shrink-0 cursor-pointer items-center justify-center rounded p-1 text-muted-foreground hover:bg-border hover:text-foreground"
            >
              <Pencil className="size-3" />
            </button>
          </div>,
          document.body,
        )}

      <EditLinkDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialText={currentText}
        initialHref={href}
        onSave={(text, newHref) => {
          handleSave(text, newHref);
          setDialogOpen(false);
        }}
      />
    </>
  );
}
