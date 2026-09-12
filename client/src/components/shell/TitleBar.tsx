import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Copy, Menu, Minus, PanelLeftClose, PanelLeftOpen, Search, Settings, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipShortcut, TooltipTrigger } from "@/components/ui/tooltip";
import { useWindowControls } from "@/hooks/useWindowControls";
import { isMacOS, shortcutLabel } from "@/lib/platform";
import { setTitleBarSlot } from "@/lib/titleBarSlot";
import { cn } from "@/lib/utils";

/** No tooltip on purpose — these are the 3 native window controls (Windows
 * Fluent convention), universally recognizable without a label. */
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
  onOpenSettings,
  connected,
}: {
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  showSidebarToggle: boolean;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  /** Unlike `MobileTopBar`, only rendered when `false` — desktop had no
   * connection feedback at all: a relay that's unreachable from the start
   * (wrong profile host/port, nothing running there) looked identical to
   * "the app is just loading", with every panel (folder picker, model/mode,
   * message send) failing silently or hanging instead. */
  connected: boolean;
}) {
  // macOS keeps the native traffic lights (Tauri's overlay mode),
  // so we don't draw minimize/maximize/close there, we just reserve their
  // space on the left so nothing ends up underneath them.
  const mac = isMacOS();
  const { isMaximized, minimize, toggleMaximize, close } = useWindowControls();

  return (
    <div className={cn("flex h-9 shrink-0 select-none border-b border-border-soft bg-bg-sidebar", mac && "pl-[78px]")}>
      <div className="flex h-full shrink-0 items-center gap-0.5 px-1">
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Menu">
                  <Menu className="size-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">Menu</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={onOpenSettings}>
              <Settings className="size-3.5" />
              Configurações
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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

      {/* The centre is both the window's drag region and the slot the focused
       * conversation portals its working directory into (`titleBarSlot.ts`).
       * `data-tauri-drag-region` only applies to this element itself, not to
       * children, so the button rendered inside stays clickable. */}
      <div
        data-tauri-drag-region
        ref={setTitleBarSlot}
        className="flex h-full min-w-0 flex-1 items-center justify-center gap-2 px-2"
      >
        {!connected && (
          <span className="flex items-center gap-1.5 font-mono text-[11px] text-destructive">
            <span className="size-1.5 animate-pulse rounded-full bg-destructive" />
            Reconectando…
          </span>
        )}
      </div>

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
