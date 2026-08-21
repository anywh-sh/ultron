import { ScrollArea } from "@/components/ui/scroll-area";
import { SessionListItem } from "@/components/shell/SessionListItem";
import type { SessionSummary } from "@/lib/relay-types";

interface SessionListProps {
  sessions: SessionSummary[];
  loading: boolean;
  selected: string | null;
  running: Set<string>;
  onSelect: (id: string) => void;
  onRename: (id: string, currentTitle: string) => void;
  onDelete: (id: string) => void;
}

export function SessionList({ sessions, loading, selected, running, onSelect, onRename, onDelete }: SessionListProps) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-0.5 p-2">
        {loading && <p className="px-2 py-1.5 text-xs text-muted-foreground">carregando…</p>}
        {!loading && sessions.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">nenhuma sessão ainda</p>
        )}
        {sessions.map((session) => (
          <SessionListItem
            key={session.id}
            session={session}
            selected={selected === session.id}
            running={running.has(session.id)}
            onSelect={onSelect}
            onRename={onRename}
            onDelete={onDelete}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
