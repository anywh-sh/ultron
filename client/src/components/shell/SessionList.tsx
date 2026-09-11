import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SessionListItem } from "@/components/shell/SessionListItem";
import { SessionListSkeleton } from "@/components/shell/SessionListSkeleton";
import { cn } from "@/lib/utils";
import type { SessionSummary } from "@/lib/relay-types";

interface SessionListProps {
  sessions: SessionSummary[];
  loading: boolean;
  /** Set once the one-shot fetch (`useSessionNames`) fails — cleared by a
   * successful `reload()` or a profile switch, never by itself. */
  error: boolean;
  onRetry: () => void;
  selected: string | null;
  running: Set<string>;
  backgroundJobSessions: Set<string>;
  onSelect: (id: string) => void;
  onRename: (id: string, currentTitle: string) => void;
  onDelete: (id: string) => void;
  /** "lg" used only by the iOS drawer (docs/24) — larger text and reduced
   * horizontal padding to align with the rest of the sidebar (which uses
   * `px-1`, not the `p-2` this component applies by default). */
  size?: "default" | "lg";
}

export function SessionList({
  sessions,
  loading,
  error,
  onRetry,
  selected,
  running,
  backgroundJobSessions,
  onSelect,
  onRename,
  onDelete,
  size = "default",
}: SessionListProps) {
  if (loading) return <SessionListSkeleton size={size} />;

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className={cn("flex flex-col gap-0.5", size === "lg" ? "pb-2" : "p-2")}>
        {error && (
          <div className="flex flex-col items-start gap-1.5 px-2 py-1.5 text-xs text-muted-foreground">
            <p>Não foi possível carregar as conversas.</p>
            <Button type="button" variant="outline" size="xs" onClick={onRetry}>
              Tentar novamente
            </Button>
          </div>
        )}
        {!error && sessions.length === 0 && (
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
