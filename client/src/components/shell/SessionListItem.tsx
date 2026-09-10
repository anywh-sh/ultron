import { Loader2, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SessionSummary } from "@/lib/relay-types";
import { useContextMenu } from "@/hooks/useContextMenu";
import { SessionDeleteMenu } from "@/components/shell/SessionDeleteMenu";

interface SessionListItemProps {
  session: SessionSummary;
  selected: boolean;
  running: boolean;
  /** `ultron-bg` job currently observed on this session (docs/32, Phase E)
   * — same limitation as `running`: only sessions open as a tab have this
   * information (no tab = no live WS connection to know it). */
  hasBackgroundJob: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, currentTitle: string) => void;
  onDelete: (id: string) => void;
  size?: "default" | "lg";
}

export function SessionListItem({
  session,
  selected,
  running,
  hasBackgroundJob,
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
          size === "lg" ? "py-2.5 pr-7 pl-2 text-base" : "py-1.5 pr-7 pl-2 text-sm",
          selected ? "bg-bg-elevated opacity-100" : "opacity-60",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{session.title}</span>
        {running && (
          <Loader2
            className="size-3 shrink-0 animate-spin text-foreground transition-opacity group-hover:opacity-0"
            aria-label="Agente trabalhando nesta sessão"
          />
        )}
        {hasBackgroundJob && (
          <Loader2
            className="size-3 shrink-0 animate-spin text-muted-foreground transition-opacity group-hover:opacity-0"
            aria-label="Job em background rodando nesta sessão"
          />
        )}
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
