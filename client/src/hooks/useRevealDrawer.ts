import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

/** Quanto o "canvas" (tela do agente inteira) desliza pra direita quando o
 * drawer de sessões abre — a mesma fração (~72% de um iPhone de 375pt) do
 * protótipo validado com o usuário (docs/24). A sidebar por trás usa este
 * mesmo valor como largura própria, não a tela inteira — ver `MobileShell`. */
export const REVEAL_PUSH_PX = 268;

/** Deslocamento mínimo, em px, pra um arraste ainda-fechado "comprometer"
 * com o gesto de abrir o drawer — abaixo disso pode ser só um toque ou o
 * início de um scroll vertical do log de mensagens. */
const OPEN_COMMIT_THRESHOLD = 10;

export interface RevealDrawerHandle {
  open: boolean;
  canvasRef: RefObject<HTMLDivElement | null>;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
  /** No canvas fechado, começa a observar qualquer arraste (não só perto da
   * borda) — só passa a mexer no canvas de verdade depois que o movimento
   * comprovar ser majoritariamente horizontal pra direita (ver
   * `OPEN_COMMIT_THRESHOLD`), pra não brigar com o scroll vertical do log. */
  onCanvasPointerDown: (event: ReactPointerEvent) => void;
  /** No bloqueador (visível só quando o drawer está aberto), qualquer ponto
   * inicia o arraste — cobre tanto "arrastar pra fechar" quanto "tocar pra
   * fechar" (um toque sem movimento conta como fechar). */
  onBlockerPointerDown: (event: ReactPointerEvent) => void;
}

/**
 * Mecanismo de "reveal" do drawer de sessões no iOS (docs/24, inspirado no
 * app Claude): em vez de um overlay com scrim por cima do conteúdo, a tela
 * inteira do agente desliza pra direita — ganhando borda sutil, cantos
 * arredondados e perdendo opacidade gradualmente conforme desliza — e a
 * sidebar aparece atrás. O arraste ao vivo manipula o DOM direto via ref
 * (sem re-render a cada pixel); só o estado `open` liga/desliga a classe
 * `.pushed` do CSS, que anima pra o estado assentado.
 */
export function useRevealDrawer(): RevealDrawerHandle {
  const [open, setOpen] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  const applyProgress = useCallback((t: number) => {
    const el = canvasRef.current;
    if (!el) return;
    const progress = t / REVEAL_PUSH_PX;
    el.style.transform = `translateX(${t}px)`;
    el.style.borderRadius = `${progress * 30}px`;
    el.style.boxShadow = t > 4 ? "-18px 26px 60px -24px rgba(0,0,0,.65)" : "none";
    el.style.opacity = String(1 - progress * 0.45);
    el.style.borderColor = `rgba(240,238,230,${progress * 0.16})`;
  }, []);

  const clearInlineStyle = useCallback(() => {
    const el = canvasRef.current;
    if (!el) return;
    el.style.transform = "";
    el.style.borderRadius = "";
    el.style.boxShadow = "";
    el.style.opacity = "";
    el.style.borderColor = "";
  }, []);

  const openDrawer = useCallback(() => setOpen(true), []);
  const closeDrawer = useCallback(() => setOpen(false), []);
  const toggleDrawer = useCallback(() => setOpen((value) => !value), []);

  /** Arraste "comprometido" — usado tanto pra fechar (a partir do
   * bloqueador, sempre ativo de cara) quanto, depois do threshold, pra
   * abrir. `onCommit` roda uma vez só, na primeira chamada que passa do
   * threshold (ou imediatamente, se `immediate`). */
  const beginDrag = useCallback(
    (startEvent: { clientX: number; clientY: number }, base: number) => {
      const startX = startEvent.clientX;
      let moved = false;
      const el = canvasRef.current;
      if (el) el.style.transition = "none";

      function handleMove(event: PointerEvent): void {
        const dx = event.clientX - startX;
        if (Math.abs(dx) > 3) moved = true;
        event.preventDefault();
        applyProgress(Math.max(0, Math.min(REVEAL_PUSH_PX, base + dx)));
      }

      function handleUp(event: PointerEvent): void {
        document.removeEventListener("pointermove", handleMove);
        document.removeEventListener("pointerup", handleUp);
        if (el) el.style.transition = "";
        clearInlineStyle();

        const dx = event.clientX - startX;
        const finalT = Math.max(0, Math.min(REVEAL_PUSH_PX, base + dx));
        if (!moved) {
          if (base === REVEAL_PUSH_PX) closeDrawer();
          else openDrawer();
        } else if (finalT > REVEAL_PUSH_PX * 0.42) {
          openDrawer();
        } else {
          closeDrawer();
        }
      }

      document.addEventListener("pointermove", handleMove, { passive: false });
      document.addEventListener("pointerup", handleUp);
    },
    [applyProgress, clearInlineStyle, openDrawer, closeDrawer],
  );

  /** Fechado: observa qualquer arraste na tela principal, sem interferir
   * (sem preventDefault, sem tocar no canvas) até o movimento provar ser
   * majoritariamente horizontal pra direita — só aí "comprometemos" com o
   * gesto de abrir via `beginDrag`. Até lá, scroll vertical do log e toques
   * em botões continuam funcionando normalmente. */
  const onCanvasPointerDown = useCallback(
    (startEvent: ReactPointerEvent) => {
      if (open) return;
      const startX = startEvent.clientX;
      const startY = startEvent.clientY;
      let committed = false;
      let abandoned = false;

      function handlePendingMove(event: PointerEvent): void {
        if (committed || abandoned) return;
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        if (dx > OPEN_COMMIT_THRESHOLD && dx > Math.abs(dy) * 1.2) {
          committed = true;
          document.removeEventListener("pointermove", handlePendingMove);
          document.removeEventListener("pointerup", handlePendingUp);
          // Recomeça o arraste "de verdade" a partir daqui, já comprometido
          // — o pequeno delta percorrido até o threshold é imperceptível.
          beginDrag(event, 0);
        } else if (Math.abs(dy) > OPEN_COMMIT_THRESHOLD && Math.abs(dy) > dx * 1.2) {
          // Movimento majoritariamente vertical — é scroll do log, não o
          // gesto de abrir. Desiste sem nunca ter interferido.
          abandoned = true;
          document.removeEventListener("pointermove", handlePendingMove);
          document.removeEventListener("pointerup", handlePendingUp);
        }
      }
      function handlePendingUp(): void {
        document.removeEventListener("pointermove", handlePendingMove);
        document.removeEventListener("pointerup", handlePendingUp);
      }

      document.addEventListener("pointermove", handlePendingMove, { passive: true });
      document.addEventListener("pointerup", handlePendingUp);
    },
    [open, beginDrag],
  );

  const onBlockerPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      event.stopPropagation();
      beginDrag(event, REVEAL_PUSH_PX);
    },
    [beginDrag],
  );

  return { open, canvasRef, openDrawer, closeDrawer, toggleDrawer, onCanvasPointerDown, onBlockerPointerDown };
}
