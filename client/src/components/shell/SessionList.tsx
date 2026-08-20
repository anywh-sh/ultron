import { Brain } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface SessionListProps {
  sessions: string[];
  loading: boolean;
  selected: string | null;
  running: Set<string>;
  onSelect: (name: string) => void;
}

export function SessionList({ sessions, loading, selected, running, onSelect }: SessionListProps) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-0.5 p-2">
        {loading && <p className="px-2 py-1.5 text-xs text-muted-foreground">carregando…</p>}
        {!loading && sessions.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">nenhuma sessão ainda</p>
        )}
        {sessions.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => onSelect(name)}
            className={cn(
              "flex w-full cursor-pointer items-center gap-1.5 truncate rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-[background-color,opacity] hover:bg-bg-elevated hover:opacity-100",
              selected === name ? "bg-bg-elevated opacity-100" : "opacity-60",
            )}
          >
            <span className="truncate">{name}</span>
            {running.has(name) && (
              <Brain
                className="size-3 shrink-0 animate-pulse text-primary"
                aria-label="Agente trabalhando nesta sessão"
              />
            )}
          </button>
        ))}
      </div>
    </ScrollArea>
  );
}
