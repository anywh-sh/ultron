import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { TerminalTab } from "@/hooks/useTerminalTabs";

interface TerminalTabStripProps {
  tabs: TerminalTab[];
  activeTerminalId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
}

/** Tira de abas "Terminal 1 / Terminal 2 / +" no cabeçalho do painel — igual
 * a screenshot de referência do VS Code. Sem drag-to-reorder (diferente da
 * `TabBar` de sessões): número de abas de terminal por sessão tende a ser
 * pequeno o bastante pra não justificar a complexidade do dnd-kit aqui. */
export function TerminalTabStrip({ tabs, activeTerminalId, onSelect, onClose, onAdd }: TerminalTabStripProps) {
  return (
    <div className="scrollbar-thin flex items-center gap-0.5 overflow-x-auto px-1 py-1">
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
            tab.id === activeTerminalId ? "text-foreground" : "text-muted-foreground",
          )}
        >
          <span className="max-w-[96px] truncate">{tab.label}</span>
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
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs" onClick={onAdd} aria-label="Novo terminal">
            <Plus className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Novo terminal</TooltipContent>
      </Tooltip>
    </div>
  );
}
