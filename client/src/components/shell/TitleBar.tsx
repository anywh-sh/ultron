import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Copy, Minus, PanelLeftClose, PanelLeftOpen, Search, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipShortcut, TooltipTrigger } from "@/components/ui/tooltip";
import { useWindowControls } from "@/hooks/useWindowControls";
import { isMacOS, shortcutLabel } from "@/lib/platform";
import { cn } from "@/lib/utils";

/** Sem tooltip de propósito — são os 3 controles nativos de janela (convenção
 * Fluent do Windows), universalmente reconhecíveis sem rótulo. */
function WindowControlButton({
  label,
  onClick,
  variant = "default",
  children,
}: {
  label: string;
  onClick: () => void;
  variant?: "default" | "close";
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex h-full w-[46px] cursor-pointer items-center justify-center text-muted-foreground transition-colors",
        variant === "close" ? "hover:bg-destructive hover:text-foreground" : "hover:bg-foreground/10 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function TitleBar({
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  showSidebarToggle,
  sidebarCollapsed,
  onToggleSidebar,
  onOpenSearch,
}: {
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  showSidebarToggle: boolean;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onOpenSearch: () => void;
}) {
  // macOS mantém os semáforos nativos (modo overlay do Tauri — docs/21), então
  // não desenhamos minimizar/maximizar/fechar lá, só reservamos o espaço deles
  // à esquerda pra nada ficar embaixo.
  const mac = isMacOS();
  const { isMaximized, minimize, toggleMaximize, close } = useWindowControls();

  return (
    <div className={cn("flex h-9 shrink-0 select-none border-b border-border-soft bg-bg-sidebar", mac && "pl-[78px]")}>
      <div className="flex h-full shrink-0 items-center gap-0.5 px-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onGoBack} disabled={!canGoBack} aria-label="Voltar">
              <ChevronLeft className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Voltar</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onGoForward} disabled={!canGoForward} aria-label="Avançar">
              <ChevronRight className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Avançar</TooltipContent>
        </Tooltip>
        {showSidebarToggle && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onToggleSidebar}
                aria-label={sidebarCollapsed ? "Expandir barra lateral" : "Colapsar barra lateral"}
              >
                {sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {sidebarCollapsed ? "Expandir barra lateral" : "Colapsar barra lateral"}
              <TooltipShortcut>{shortcutLabel("B")}</TooltipShortcut>
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onOpenSearch} aria-label="Buscar sessão">
              <Search className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Buscar sessão
            <TooltipShortcut>{shortcutLabel("K")}</TooltipShortcut>
          </TooltipContent>
        </Tooltip>
      </div>

      <div data-tauri-drag-region className="h-full flex-1" />

      {!mac && (
        <div className="flex h-full shrink-0">
          <WindowControlButton label="Minimizar" onClick={minimize}>
            <Minus className="size-3" strokeWidth={1.5} />
          </WindowControlButton>
          <WindowControlButton label={isMaximized ? "Restaurar" : "Maximizar"} onClick={toggleMaximize}>
            {isMaximized ? <Copy className="size-3 -scale-x-100" strokeWidth={1.5} /> : <Square className="size-3" strokeWidth={1.5} />}
          </WindowControlButton>
          <WindowControlButton label="Fechar" onClick={close} variant="close">
            <X className="size-3.5" strokeWidth={1.5} />
          </WindowControlButton>
        </div>
      )}
    </div>
  );
}
