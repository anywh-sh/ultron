import { ScrollArea } from "@/components/ui/scroll-area";
import { SessionListItem } from "@/components/shell/SessionListItem";
import { cn } from "@/lib/utils";
import type { SessionSummary } from "@/lib/relay-types";

interface SessionListProps {
  sessions: SessionSummary[];
  loading: boolean;
  selected: string | null;
  running: Set<string>;
  backgroundJobSessions: Set<string>;
  onSelect: (id: string) => void;
  onRename: (id: string, currentTitle: string) => void;
  onDelete: (id: string) => void;
  /** "lg" usado só pelo drawer do iOS (docs/24) — texto maior e padding
   * horizontal reduzido pra alinhar com o resto da sidebar (que usa `px-1`,
   * não o `p-2` que este componente aplica por padrão). */
  size?: "default" | "lg";
}

export function SessionList({
  sessions,
  loading,
  selected,
  running,
  backgroundJobSessions,
  onSelect,
  onRename,
  onDelete,
  size = "default",
}: SessionListProps) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className={cn("flex flex-col gap-0.5", size === "lg" ? "pb-2" : "p-2")}>
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
            hasBackgroundJob={backgroundJobSessions.has(session.id)}
            onSelect={onSelect}
            onRename={onRename}
            onDelete={onDelete}
            size={size}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
