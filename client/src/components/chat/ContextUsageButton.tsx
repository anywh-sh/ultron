import { useRef } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ContextUsageRing } from "@/components/chat/ContextUsageRing";
import { contextUsageColor, contextUsagePercent, formatTokenCount } from "@/lib/contextUsage";
import type { ContextUsage } from "@/lib/relayClient";

interface ContextUsageButtonProps {
  usage: ContextUsage | null;
}

/**
 * Ring + detail popover for the context window, same pattern as
 * `PermissionModeButton`/`WorkingDirectoryButton`: `DropdownMenu` with
 * `modal={false}` (Radix traps focus/pointer-events on the body while a
 * modal dropdown is open, and restoration fails on Tauri's WKWebView on
 * macOS — docs/24) and blurs the trigger on close (otherwise a neighboring
 * button's Tooltip would get "stuck" open by inheriting the focus). `usage`
 * null (session with no turn yet) hides the whole button, same as the ring
 * alone already did.
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
          {/* Same color function as the ring (contextUsageColor) — the bar
           * inside here is just the linear version of the same data, never diverges. */}
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
