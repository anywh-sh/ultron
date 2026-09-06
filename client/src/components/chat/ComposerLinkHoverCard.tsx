import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getMarkRange, type Editor, type Range } from "@tiptap/core";
import { Pencil } from "lucide-react";
import { EditLinkDialog } from "@/components/chat/EditLinkDialog";

const OPEN_DELAY_MS = 150;
const CLOSE_DELAY_MS = 150;

interface ComposerLinkHoverCardProps {
  editor: Editor | null;
}

/** Hover card (href + editar) pro link criado por paste-to-link no composer.
 * Uma instância só por `Composer` (não por link) com listeners nativos em
 * `editor.view.dom` via delegação de evento — não um Tiptap MarkView por
 * link como antes. O MarkView (`ReactMarkViewRenderer`/`addMarkView`) tem um
 * bug real e reproduzido (não só suspeita): qualquer marca renderizada por
 * ele quebra o mapeamento posição-doc↔DOM do ProseMirror (`view.domAtPos`
 * cai pro `<div contenteditable>` em vez de descer até o texto certo) assim
 * que ela existe no documento — não só na borda dela, no parágrafo inteiro.
 * Reproduzido isolado (fora do app) com Playwright: colar um link deixava o
 * cursor "grudado" na posição de antes do paste (bug 1 relatado pelo
 * usuário), colar sobre um texto selecionado tinha o mesmo problema (bug 2),
 * e apagar uma seleção que incluía um link deixava sem seleção nativa
 * nenhuma, cursor "sumido" (bug 3) — sem o MarkView (mark renderizada como
 * `<a>` puro via `renderHTML`, sem `contentDOM` próprio) os três somem, os
 * mesmos passos reproduzidos isolados voltam a posicionar o cursor certo.
 * O preço é este arquivo: hover/editar não pode mais viver dentro do próprio
 * elemento do link (não existe mais um componente React por link), então a
 * detecção de hover e o `range`/atributos do link editado são resolvidos a
 * partir do elemento DOM nativo (`closest("a.composer-link")` + `posAtDOM` +
 * `getMarkRange`, mesma técnica que o MarkView já usava no hover). */
export function ComposerLinkHoverCard({ editor }: ComposerLinkHoverCardProps) {
  const [cardOpen, setCardOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [currentText, setCurrentText] = useState("");
  const [currentHref, setCurrentHref] = useState("");
  const rangeRef = useRef<Range | null>(null);
  const attrsRef = useRef<Record<string, unknown>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimer(): void {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function scheduleClose(): void {
    clearTimer();
    timerRef.current = setTimeout(() => setCardOpen(false), CLOSE_DELAY_MS);
  }

  useEffect(() => clearTimer, []);

  useEffect(() => {
    if (!editor) return;
    const currentEditor = editor;
    const dom = editor.view.dom;

    function linkElementFromEvent(event: Event): HTMLAnchorElement | null {
      const target = event.target;
      return target instanceof HTMLElement ? target.closest<HTMLAnchorElement>("a.composer-link") : null;
    }

    function handleMouseOver(event: MouseEvent): void {
      const link = linkElementFromEvent(event);
      if (!link) return;
      clearTimer();
      timerRef.current = setTimeout(() => {
        const linkType = currentEditor.schema.marks.link;
        const pos = currentEditor.view.posAtDOM(link, 0, 1);
        const $pos = currentEditor.state.doc.resolve(Math.min(pos + 1, currentEditor.state.doc.content.size));
        const range = linkType ? (getMarkRange($pos, linkType) ?? null) : null;
        rangeRef.current = range;
        // Lido aqui, no exato doc em que `range` foi resolvido — nunca no
        // render (o doc pode já ter mudado e invalidado `range` nesse
        // meio-tempo, ex.: logo depois de salvar uma edição, `textBetween`
        // com um range de antes da edição explode contra o doc novo).
        const linkMark = range ? currentEditor.state.doc.nodeAt(range.from)?.marks.find((mark) => mark.type === linkType) : undefined;
        attrsRef.current = linkMark?.attrs ?? { href: link.getAttribute("href") };
        setCurrentText(range ? currentEditor.state.doc.textBetween(range.from, range.to) : "");
        setCurrentHref(link.getAttribute("href") ?? "");
        setAnchorRect(link.getBoundingClientRect());
        setCardOpen(true);
      }, OPEN_DELAY_MS);
    }

    function handleMouseOut(event: MouseEvent): void {
      if (linkElementFromEvent(event)) scheduleClose();
    }

    // `<a href>` real dentro do contenteditable navegaria a página ao
    // clicar — o `Link` do Tiptap não faz `preventDefault` sozinho quando
    // `openOnClick: false` (só evita chamar `window.open`). Não impede o
    // posicionamento normal do cursor: o ProseMirror decide isso a partir
    // do `mousedown`, não do `click`.
    function handleClick(event: MouseEvent): void {
      if (linkElementFromEvent(event)) event.preventDefault();
    }

    dom.addEventListener("mouseover", handleMouseOver);
    dom.addEventListener("mouseout", handleMouseOut);
    dom.addEventListener("click", handleClick);
    return () => {
      dom.removeEventListener("mouseover", handleMouseOver);
      dom.removeEventListener("mouseout", handleMouseOut);
      dom.removeEventListener("click", handleClick);
    };
  }, [editor]);

  function handleSave(text: string, newHref: string): void {
    const range = rangeRef.current;
    if (!range || !editor) return;
    editor
      .chain()
      .focus()
      .insertContentAt(range, {
        type: "text",
        text,
        marks: [{ type: "link", attrs: { ...attrsRef.current, href: newHref } }],
      })
      .run();
  }

  return (
    <>
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
            <span className="max-w-56 truncate font-mono text-xs text-muted-foreground">{currentHref}</span>
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
        initialHref={currentHref}
        onSave={(text, newHref) => {
          handleSave(text, newHref);
          setDialogOpen(false);
        }}
      />
    </>
  );
}
