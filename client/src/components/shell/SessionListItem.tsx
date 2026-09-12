import { Loader2, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDict, useLocale } from "@/i18n";
import { profileColorClass } from "@/lib/profiles";
import { formatRelativeTime } from "@/lib/relativeTime";
import type { MergedSession } from "@/lib/sessionGrouping";
import { useContextMenu } from "@/hooks/useContextMenu";
import { SessionDeleteMenu } from "@/components/shell/SessionDeleteMenu";

interface SessionListItemProps {
  session: MergedSession;
  /** The profile's label, resolved by the list — the row only carries an id,
   * and looking the label up per row would walk the profiles array once for
   * every session on screen. */
  profileLabel: string;
  /** Whether the profile name is worth the second line at all: with a single
   * profile in view it is the same word on every row. The colour bar stays
   * either way, since it also reads as the selection indicator. */
  showProfile: boolean;
  selected: boolean;
  running: boolean;
  /** `anywh-bg` job currently observed on this session
   * — same limitation as `running`: only sessions open as a tab have this
   * information (no tab = no live WS connection to know it). */
  hasBackgroundJob: boolean;
  onSelect: (session: MergedSession) => void;
  onRename: (session: MergedSession) => void;
  onDelete: (session: MergedSession) => void;
  size?: "default" | "lg";
}

export function SessionListItem({
  session,
  profileLabel,
  showProfile,
  selected,
  running,
  hasBackgroundJob,
  onSelect,
  onRename,
  onDelete,
  size = "default",
}: SessionListItemProps) {
  const dict = useDict();
  const { locale } = useLocale();
  const menu = useContextMenu();
  const spinnerLabel = running ? dict.shell.sidebar.agentWorking : dict.shell.sidebar.backgroundJob;

  return (
    <div className="group relative flex items-center" onContextMenu={menu.onContextMenu}>
      {/* The profile's colour as a bar down the left edge, not a dot: it is
       * the one piece of per-row chrome that has to survive a long title
       * truncating, and it doubles as the selected-row marker. */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 left-0 w-0.5 shrink-0",
          profileColorClass(session.profileId),
          !selected && "opacity-55",
        )}
      />
      <button
        type="button"
        onClick={() => onSelect(session)}
        className={cn(
          "flex w-full cursor-pointer flex-col gap-0.5 border border-transparent pr-7 pl-3 text-left transition-colors",
          size === "lg" ? "py-2.5" : "py-2",
          selected ? "border-border bg-bg-elevated" : "hover:bg-surface-hover",
        )}
      >
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              size === "lg" ? "text-base" : "text-[13px]",
              selected ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {session.title}
          </span>
          {/* One animated indicator per row at most — a live turn and a
           * background job on the same session would otherwise stack two
           * infinite spinners in one line. */}
          {(running || hasBackgroundJob) && (
            <Loader2
              className={cn("size-3 shrink-0 animate-spin", running ? "text-foreground" : "text-muted-foreground")}
              aria-label={spinnerLabel}
            />
          )}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 font-mono text-[10.5px] text-text-faint">
          {showProfile && (
            <>
              <span className="max-w-22 shrink-0 truncate">{profileLabel}</span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <span className="truncate">{formatRelativeTime(session.lastActiveAt, locale)}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onRename(session);
        }}
        aria-label={dict.shell.sidebar.renameSession.replace("{title}", session.title)}
        className={cn(
          "absolute top-1.5 right-1.5 cursor-pointer p-0.5 opacity-0 transition-opacity",
          "hover:bg-bg-elevated group-hover:opacity-100",
        )}
      >
        <Pencil className="size-3" />
      </button>
      <SessionDeleteMenu menu={menu} title={session.title} onDelete={() => onDelete(session)} />
    </div>
  );
}
