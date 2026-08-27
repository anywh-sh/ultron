import type { ReactNode } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface SessionPanelProps {
  maximized: boolean;
  onStartDrag: (event: React.PointerEvent) => void;
  onToggleMaximized: () => void;
  onClose: () => void;
  /** Conteúdo específico do `kind` do painel, no cabeçalho — ex: a tira de
   * abas do terminal. A casca não sabe o que é. */
  headerExtra: ReactNode;
  children: ReactNode;
}

/**
 * Casca genérica do painel lateral direito — resize/maximizar/fechar, sem
 * saber nada do conteúdo que hospeda. Terminal é o primeiro consumidor
 * (`TerminalPanelContent`); o visualizador de arquivos do work dir
 * (planejado) reaproveita esta mesma casca depois, só trocando `headerExtra`
 * e `children` (ver useSessionPanels.ts pro porquê de painel e conteúdo
 * serem coisas separadas). Largura/animação de abrir-fechar não são
 * responsabilidade daqui — `TerminalPanelSlot` já entrega um espaço do
 * tamanho certo (ver comentário lá); esta casca só preenche 100% dele.
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
        {/* `py-1` igual ao wrapper da tira de abas (TerminalTabStrip) — sem
         * isso a altura da linha era ditada pelo próprio botão (`icon-sm`,
         * maior que os `icon-xs` das abas), então o hover dele encostava
         * direto nas bordas de cima/baixo, sem gap nenhum. `icon-xs` aqui
         * também deixa maximizar/fechar do mesmo tamanho do "+" da tira. */}
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
