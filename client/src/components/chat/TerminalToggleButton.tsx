import { SquareTerminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDict } from "@/i18n";
import { Tooltip, TooltipContent, TooltipShortcut, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface TerminalToggleButtonProps {
  cwd: string | null;
  open: boolean;
  onToggle: () => void;
}

/**
 * Embedded terminal button — next to `WorkingDirectoryButton` in
 * the same row, aligned to the far right (`ChatPanel` handles the
 * `justify-between` between the two). Disabled until the session has a
 * folder (the terminal is born in it — see terminalSession.ts), same gating
 * logic `WorkingDirectoryButton` already uses for "a session without a
 * folder yet can't do anything that depends on one".
 */
export function TerminalToggleButton({ cwd, open, onToggle }: TerminalToggleButtonProps) {
  const dict = useDict();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!cwd}
          onClick={onToggle}
          aria-label={open ? dict.panels.closeTerminal : dict.panels.openTerminal}
          className={cn(open && "bg-bg-elevated")}
        >
          <SquareTerminal className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {open ? dict.panels.closeTerminal : dict.panels.openTerminal}
        {/* Literal Ctrl even on macOS — VS Code's own convention, whose
         * integrated terminal shortcut uses Control on any OS because
         * Cmd+` is already reserved by macOS (switching between windows of
         * the same app), same reasoning as Ctrl+Tab in App.tsx. */}
        <TooltipShortcut>Ctrl+`</TooltipShortcut>
      </TooltipContent>
    </Tooltip>
  );
}
