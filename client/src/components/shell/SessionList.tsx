import { useMemo } from "react";
import { MessageSquareDashed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SessionListItem } from "@/components/shell/SessionListItem";
import { SessionListSkeleton } from "@/components/shell/SessionListSkeleton";
import { useDict } from "@/i18n";
import { cn } from "@/lib/utils";
import type { Profile } from "@/lib/profiles";
import { groupSessionsByRecency, type MergedSession } from "@/lib/sessionGrouping";

interface SessionListProps {
  /** Already merged across the selected profiles and sorted newest-first. */
  sessions: MergedSession[];
  profiles: Profile[];
  /** How many profiles the filter currently shows — drives whether a row
   * needs to name its profile, and tells the empty state whether the list is
   * empty because there is nothing or because the filter hid it. */
  selectedProfileCount: number;
  loading: boolean;
  /** Set once the active profile's fetch (`useSessionNames`) fails — cleared
   * by a successful `reload()` or a profile switch, never by itself. */
  error: boolean;
  onRetry: () => void;
  selected: string | null;
  running: Set<string>;
  backgroundJobSessions: Set<string>;
  onSelect: (session: MergedSession) => void;
  onRename: (session: MergedSession) => void;
  onDelete: (session: MergedSession) => void;
  onClearFilter: () => void;
  /** "lg" used only by the iOS drawer — larger text to match the rest of
   * that sheet. */
  size?: "default" | "lg";
}

export function SessionList({
  sessions,
  profiles,
  selectedProfileCount,
  loading,
  error,
  onRetry,
  selected,
  running,
  backgroundJobSessions,
  onSelect,
  onRename,
  onDelete,
  onClearFilter,
  size = "default",
}: SessionListProps) {
  const dict = useDict();
  const groups = useMemo(() => groupSessionsByRecency(sessions), [sessions]);
  // One pass instead of a lookup per row: the list can hold every session of
  // every profile now, and this renders on each sidebar render.
  const labels = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile.label])), [profiles]);
  const showProfile = selectedProfileCount > 1;
  // "Nothing here" and "nothing here *because of the filter*" are different
  // answers, and conflating them is how someone concludes their history is
  // gone when they have narrowed the view down to a profile with nothing in
  // it.
  const filtering = selectedProfileCount < profiles.length;

  // Same sizing as the `ScrollArea` below (`min-h-0 flex-1`) — without it,
  // the skeleton's own content height (a handful of fixed-width bars) is
  // all the flex column gives this slot, and whatever sits after `SessionList`
  // in the layout (`ProfileSwitcher`'s footer in Sidebar.tsx) gets pulled up
  // instead of staying pinned to the bottom while sessions load.
  if (loading && sessions.length === 0)
    return (
      <div className="min-h-0 flex-1">
        <SessionListSkeleton size={size} />
      </div>
    );

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className={cn("flex flex-col", size === "lg" ? "pb-2" : "px-2 pb-3")}>
        {error && (
          <div className="flex flex-col items-start gap-2 px-2 py-2 text-xs text-muted-foreground">
            <p>{dict.shell.sidebar.loadFailed}</p>
            <Button type="button" variant="outline" size="xs" onClick={onRetry}>
              {dict.common.retry}
            </Button>
          </div>
        )}

        {!error && sessions.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-5 py-9 text-center">
            <span className="flex size-8 items-center justify-center border border-dashed border-border text-text-faint">
              <MessageSquareDashed className="size-4" />
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {filtering ? dict.shell.sidebar.noMatches : dict.shell.sidebar.emptyTitle}
            </span>
            {filtering ? (
              <Button type="button" variant="outline" size="xs" onClick={onClearFilter}>
                {dict.shell.sidebar.allProfiles}
              </Button>
            ) : (
              <span className="max-w-48 text-xs leading-relaxed text-text-faint">{dict.shell.sidebar.emptyBody}</span>
            )}
          </div>
        )}

        {groups.map((group) => (
          <div key={group.id}>
            <div className="px-1 pt-4 pb-1.5 font-mono text-[10px] tracking-[0.14em] text-text-faint uppercase first:pt-2">
              {dict.shell.sidebar.groups[group.id]}
              <span className="opacity-75"> {group.sessions.length}</span>
            </div>
            {group.sessions.map((session) => (
              <SessionListItem
                key={`${session.profileId}:${session.id}`}
                session={session}
                profileLabel={labels.get(session.profileId) ?? session.profileId}
                showProfile={showProfile}
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
        ))}
      </div>
    </ScrollArea>
  );
}
