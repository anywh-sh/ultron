import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, scrollHorizontallyOnWheel } from "@/lib/utils";

export interface PaneTab {
  id: string;
  label: string;
  /** File panel's preview tab (decision 6, docs/41) — unpinned, shown in
   * italic, same convention as VS Code/Claude Desktop. The terminal never
   * sets this (every terminal tab is "pinned"). */
  italic?: boolean;
}

interface PaneTabStripProps {
  tabs: PaneTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  /** Absent for the files pane — there's no "new file" in a read-only
   * viewer, unlike the terminal's "+". */
  onAdd?: () => void;
  addLabel?: string;
}

/** Generic tab strip for a dock pane's header — "Terminal 1 / Terminal 2 / +"
 * for the terminal, open files for the file viewer. Was `TerminalTabStrip`
 * before docs/41 generalized it to both panes; no drag-to-reorder (unlike
 * the sessions' `TabGroupStrip`) — the number of tabs per pane tends to be small
 * enough not to justify dnd-kit's complexity here. */
export function PaneTabStrip({ tabs, activeId, onSelect, onClose, onAdd, addLabel }: PaneTabStripProps) {
  return (
    <div
      onWheel={scrollHorizontallyOnWheel}
      // See TabGroupStrip's identical comment: `overflow-x-auto` alone implies
      // `overflow-y: auto` too per spec, so this strip needs `overflow-y-hidden`
      // spelled out to stay horizontal-only when it gets squeezed.
      className="scrollbar-thin flex items-center gap-0.5 overflow-x-auto overflow-y-hidden px-1 py-1"
    >
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="button"
          tabIndex={0}
          onClick={() => onSelect(tab.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") onSelect(tab.id);
          }}
          className={cn(
            "group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md py-1 pr-1 pl-2.5 font-mono text-xs hover:bg-border",
            tab.id === activeId ? "text-foreground" : "text-muted-foreground",
          )}
        >
          <span className={cn("max-w-[96px] truncate", tab.italic && "italic")}>{tab.label}</span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onClose(tab.id);
            }}
            aria-label={`Fechar ${tab.label}`}
            className="cursor-pointer rounded p-0.5 opacity-0 hover:bg-border group-hover:opacity-100"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
      {onAdd && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" onClick={onAdd} aria-label={addLabel ?? "Novo"}>
              <Plus className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{addLabel ?? "Novo"}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
