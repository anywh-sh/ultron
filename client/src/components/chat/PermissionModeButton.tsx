import { useRef } from "react";
import { Check, ChevronDown, ShieldAlert } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PermissionMode } from "@/lib/relayClient";
import { cn } from "@/lib/utils";

interface PermissionModeButtonProps {
  mode: PermissionMode | null;
  onChange: (mode: PermissionMode) => void;
}

// 4 dos 6 valores que `claude --permission-mode` aceita — `auto` e `dontAsk`
// ficaram de fora de propósito (ver docs/25). Ordem alinhada ao ciclo
// Shift+Tab da CLI (default -> acceptEdits -> plan), bypass por último por
// ser o mais arriscado.
const MODES: { value: PermissionMode; label: string }[] = [
  { value: "default", label: "Manual" },
  { value: "acceptEdits", label: "Accept edits" },
  { value: "plan", label: "Plan mode" },
  { value: "bypassPermissions", label: "Bypass permissions" },
];

function labelFor(mode: PermissionMode | null): string {
  return MODES.find((m) => m.value === mode)?.label ?? "…";
}

/**
 * Label + dropdown na mesma linha do anexar arquivo/áudio do `Composer`,
 * espelhando o `WorkingDirectoryButton` (mesmo pill de botão, mesmo
 * `modal={false}` — Radix trava foco/pointer-events no body enquanto um
 * dropdown modal está aberto, e a restauração falha no WKWebView do Tauri
 * no macOS).
 */
export function PermissionModeButton({ mode, onChange }: PermissionModeButtonProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);

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
          disabled={mode === null}
          className="flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-border bg-bg-elevated px-2 text-xs text-foreground transition-colors hover:bg-border disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ShieldAlert className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{labelFor(mode)}</span>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start">
        {MODES.map((option) => (
          <DropdownMenuItem key={option.value} onSelect={() => onChange(option.value)}>
            <Check className={cn("size-3.5", option.value !== mode && "opacity-0")} />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
