import { Brain, Pencil } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { SessionSummary } from "@/lib/relay-types";

interface SessionListProps {
  sessions: SessionSummary[];
  loading: boolean;
  selected: string | null;
  running: Set<string>;
  onSelect: (id: string) => void;
  onRename: (id: string, currentTitle: string) => void;
}

export function SessionList({ sessions, loading, selected, running, onSelect, onRename }: SessionListProps) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-0.5 p-2">
        {loading && <p className="px-2 py-1.5 text-xs text-muted-foreground">carregando…</p>}
        {!loading && sessions.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">nenhuma sessão ainda</p>
        )}
        {sessions.map((session) => (
          <div key={session.id} className="group relative flex items-center">
            <button
              type="button"
              onClick={() => onSelect(session.id)}
              className={cn(
                "flex w-full cursor-pointer items-center gap-1.5 truncate rounded-md py-1.5 pr-7 pl-2 text-left text-sm text-foreground transition-[background-color,opacity] hover:bg-bg-elevated hover:opacity-100",
                selected === session.id ? "bg-bg-elevated opacity-100" : "opacity-60",
              )}
            >
              <span className="truncate">{session.title}</span>
              {running.has(session.id) && (
                <Brain
                  className="size-3 shrink-0 animate-pulse text-primary"
                  aria-label="Agente trabalhando nesta sessão"
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
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
