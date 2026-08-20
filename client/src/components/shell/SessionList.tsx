import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface SessionListProps {
  sessions: string[];
  loading: boolean;
  selected: string | null;
  onSelect: (name: string) => void;
}

export function SessionList({ sessions, loading, selected, onSelect }: SessionListProps) {
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
              "cursor-pointer rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-bg-elevated",
              selected === name && "bg-bg-elevated",
            )}
          >
            {name}
          </button>
        ))}
      </div>
    </ScrollArea>
  );
}
