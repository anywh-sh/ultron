import type { ReactNode } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface SessionPanelProps {
  maximized: boolean;
  onStartDrag: (event: React.PointerEvent) => void;
  onToggleMaximized: () => void;
  onClose: () => void;
  /** Content specific to the panel's `kind`, in the header — e.g. the
   * terminal's tab strip. The shell doesn't know what it is. */
  headerExtra: ReactNode;
  children: ReactNode;
}

/**
 * Generic shell for the right-side panel — resize/maximize/close, without
 * knowing anything about the content it hosts. Terminal is the first
 * consumer (`TerminalPanelContent`); the work dir file viewer (planned)
 * reuses this same shell later, just swapping `headerExtra` and `children`
 * (see useSessionPanels.ts for why panel and content are separate things).
 * Width/open-close animation aren't this shell's responsibility —
 * `TerminalPanelSlot` already delivers a space of the right size (see
 * comment there); this shell just fills 100% of it.
 */
export function SessionPanel({ maximized, onStartDrag, onToggleMaximized, onClose, headerExtra, children }: SessionPanelProps) {
  return (
    <div className="relative flex h-full w-full min-w-0 flex-col border-l border-border-soft bg-bg-sidebar">
      {!maximized && (
        <div
          onPointerDown={onStartDrag}
          className="absolute top-0 left-0 z-10 h-full w-1 cursor-col-resize hover:bg-border"
        />
      )}

      <div className="flex shrink-0 items-center justify-between border-b border-border-soft">
        <div className="min-w-0 flex-1">{headerExtra}</div>
        {/* `py-1` same as the tab strip wrapper (TerminalTabStrip) — without
         * this the row's height was dictated by the button itself
         * (`icon-sm`, bigger than the tabs' `icon-xs`), so its hover
         * touched the top/bottom edges directly, with no gap at all.
         * `icon-xs` here also makes maximize/close the same size as the
         * strip's "+". */}
        <div className="flex shrink-0 items-center gap-0.5 px-1 py-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" onClick={onToggleMaximized} aria-label={maximized ? "Restaurar painel" : "Expandir painel"}>
                {maximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{maximized ? "Restaurar" : "Expandir"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Fechar painel">
                <X className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Fechar</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
