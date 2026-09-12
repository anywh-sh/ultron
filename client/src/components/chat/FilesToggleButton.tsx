import { FolderTree } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDict } from "@/i18n";
import { Tooltip, TooltipContent, TooltipShortcut, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface FilesToggleButtonProps {
  cwd: string | null;
  open: boolean;
  onToggle: () => void;
}

/**
 * Work dir file panel button — sibling of `TerminalToggleButton`,
 * immediately to its left (files, then terminal, at the far right of the
 * row — `ChatPanel` handles the layout). Same gating as the terminal:
 * disabled until the session has a folder, since there's nothing to list
 * without one.
 */
export function FilesToggleButton({ cwd, open, onToggle }: FilesToggleButtonProps) {
  const dict = useDict();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!cwd}
          onClick={onToggle}
          aria-label={open ? dict.panels.closeFiles : dict.panels.openFiles}
          className={cn(open && "bg-bg-elevated")}
        >
          <FolderTree className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {open ? dict.panels.closeFiles : dict.panels.openFiles}
        {/* Literal Ctrl even on macOS — VS Code's own Explorer shortcut,
         * same reasoning as the terminal's `Ctrl+\``. */}
        <TooltipShortcut>Ctrl+Shift+E</TooltipShortcut>
      </TooltipContent>
    </Tooltip>
  );
}
