import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SlashCommandEntry } from "@/lib/slashCommands";
import { cn } from "@/lib/utils";

interface SlashCommandMenuProps {
  items: SlashCommandEntry[];
  selectedIndex: number;
  onHover: (index: number) => void;
  onPick: (entry: SlashCommandEntry) => void;
}

/**
 * Composer autocomplete popup — opens only when `/` is the
 * first character typed (see Tiptap's `Suggestion` in Composer.tsx).
 * The selected/hovered item's description appears as a real tooltip on the
 * right side (project's `Tooltip`, `side="right"`) — `open` controlled by
 * the selected index instead of Radix's native hover, so it works the same
 * whether navigating by keyboard or mousing over.
 */
export function SlashCommandMenu({ items, selectedIndex, onHover, onPick }: SlashCommandMenuProps) {
  if (items.length === 0) return null;

  return (
    <ul className="z-50 max-h-56 w-48 overflow-y-auto rounded-xl border border-border bg-bg-elevated p-1 shadow-lg">
      {items.map((entry, index) => (
        <li key={entry.command}>
          <Tooltip open={index === selectedIndex}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onMouseEnter={() => onHover(index)}
                onClick={() => onPick(entry)}
                className={cn(
                  "block w-full cursor-pointer truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                  index === selectedIndex ? "bg-border text-primary" : "text-foreground hover:bg-border/60",
                )}
              >
                {entry.command}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{entry.description}</TooltipContent>
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}
