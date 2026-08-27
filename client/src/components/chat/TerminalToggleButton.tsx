import { SquareTerminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipShortcut, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface TerminalToggleButtonProps {
  cwd: string | null;
  open: boolean;
  onToggle: () => void;
}

/**
 * Botão de terminal embutido (docs/30) — ao lado do `WorkingDirectoryButton`
 * na mesma linha, alinhado à extrema direita (`ChatPanel` cuida do
 * `justify-between` entre os dois). Desabilitado até a sessão ter uma pasta
 * (o terminal nasce nela — ver terminalSession.ts), mesma lógica de gate
 * que `WorkingDirectoryButton` já usa pra "sessão sem pasta ainda não dá
 * pra fazer nada que dependa dela".
 */
export function TerminalToggleButton({ cwd, open, onToggle }: TerminalToggleButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!cwd}
          onClick={onToggle}
          aria-label={open ? "Fechar terminal" : "Abrir terminal"}
          className={cn(open && "bg-bg-elevated")}
        >
          <SquareTerminal className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {open ? "Fechar terminal" : "Abrir terminal"}
        {/* Ctrl literal mesmo no macOS — convenção do próprio VS Code, cujo
         * atalho de terminal integrado usa Control em qualquer SO porque
         * Cmd+` já é reservado pelo macOS (trocar entre janelas do mesmo
         * app), mesmo raciocínio do Ctrl+Tab em App.tsx. */}
        <TooltipShortcut>Ctrl+`</TooltipShortcut>
      </TooltipContent>
    </Tooltip>
  );
}
