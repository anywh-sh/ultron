import { useRef } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ContextUsageRing } from "@/components/chat/ContextUsageRing";
import { contextUsageColor, contextUsagePercent, formatTokenCount } from "@/lib/contextUsage";
import type { ContextUsage } from "@/lib/relayClient";

interface ContextUsageButtonProps {
  usage: ContextUsage | null;
}

/**
 * Anel + popover de detalhe da janela de contexto, mesmo padrão de
 * `PermissionModeButton`/`WorkingDirectoryButton`: `DropdownMenu` com
 * `modal={false}` (Radix trava foco/pointer-events no body enquanto um
 * dropdown modal está aberto, e a restauração falha no WKWebView do Tauri
 * no macOS — docs/24) e blur do trigger ao fechar (senão o Tooltip de
 * botões vizinhos ficaria "preso" aberto por herdar o foco). `usage` nulo
 * (sessão sem turno ainda) esconde o botão inteiro, igual o anel sozinho já
 * fazia.
 */
export function ContextUsageButton({ usage }: ContextUsageButtonProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  if (!usage) return null;

  const pct = contextUsagePercent(usage);
  const barColor = contextUsageColor(pct);

  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => {
        if (!open) triggerRef.current?.blur();
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-label={`Janela de contexto: ${String(Math.round(pct))}% usada`}
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-border"
        >
          <ContextUsageRing usage={usage} />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2 text-foreground">
            <span>Janela de contexto</span>
            <span className="font-mono text-xs">{Math.round(pct)}%</span>
          </div>
          {/* Mesma função de cor do anel (contextUsageColor) — a barra aqui
           * dentro é só a versão linear do mesmo dado, nunca diverge. */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full transition-[width] duration-300 ease-out"
              style={{ width: `${String(Math.min(100, Math.max(0, pct)))}%`, backgroundColor: barColor }}
            />
          </div>
          <span className="font-mono text-xs whitespace-nowrap text-foreground">
            {formatTokenCount(usage.usedTokens)} / {formatTokenCount(usage.contextWindowSize)} tokens
          </span>
          <span className="text-[11px] whitespace-nowrap text-muted-foreground">{usage.model}</span>
        </DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
