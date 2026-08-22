import { Brain, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SessionSummary } from "@/lib/relay-types";
import { useContextMenu } from "@/hooks/useContextMenu";
import { SessionDeleteMenu } from "@/components/shell/SessionDeleteMenu";

interface SessionListItemProps {
  session: SessionSummary;
  selected: boolean;
  running: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, currentTitle: string) => void;
  onDelete: (id: string) => void;
  size?: "default" | "lg";
}

export function SessionListItem({
  session,
  selected,
  running,
  onSelect,
  onRename,
  onDelete,
  size = "default",
}: SessionListItemProps) {
  const menu = useContextMenu();

  return (
    <div className="group relative flex items-center" onContextMenu={menu.onContextMenu}>
      <button
        type="button"
        onClick={() => onSelect(session.id)}
        className={cn(
          "flex w-full cursor-pointer items-center gap-1.5 truncate rounded-md text-left text-foreground transition-[background-color,opacity] hover:bg-bg-elevated hover:opacity-100",
          size === "lg" ? "py-2.5 pr-7 pl-1 text-base" : "py-1.5 pr-7 pl-2 text-sm",
          selected ? "bg-bg-elevated opacity-100" : "opacity-60",
        )}
      >
        <span className="truncate">{session.title}</span>
        {running && <Brain className="size-3 shrink-0 animate-pulse text-primary" aria-label="Agente trabalhando nesta sessão" />}
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onRename(session.id, session.title);
        }}
        aria-label={`Renomear ${session.title}`}
        className={cn(
          "absolute right-1.5 cursor-pointer rounded p-0.5 opacity-0 transition-opacity",
          "hover:bg-border group-hover:opacity-100",
        )}
      >
        <Pencil className="size-3" />
      </button>
      <SessionDeleteMenu menu={menu} title={session.title} onDelete={() => onDelete(session.id)} />
    </div>
  );
}
