import { ListFilter } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSessionListCache } from "@/hooks/useMergedSessions";
import { useDict, useLocale } from "@/i18n";
import { profileColorClass, type Profile } from "@/lib/profiles";
import { formatRelativeTime } from "@/lib/relativeTime";
import { cn } from "@/lib/utils";

interface ProfileFilterProps {
  profiles: Profile[];
  selected: ReadonlySet<string>;
  onToggle: (profileId: string) => void;
  onSelectAll: () => void;
}

/**
 * Which profiles the session list shows — a separate control from
 * `ProfileSwitcher`, on purpose. The switcher answers "which profile am I
 * working in" (it drives the connection, the theme, where a new conversation
 * lands); this one answers "which profiles am I looking at", and the two
 * stopped being the same question the moment the list merged every profile
 * into one.
 *
 * Multi-select, so the answer can be more than one profile without being all
 * of them. Every profile selected is the default and also the way to say
 * "everything" — there is no separate "all" state to keep in sync.
 */
export function ProfileFilter({ profiles, selected, onToggle, onSelectAll }: ProfileFilterProps) {
  const dict = useDict();
  const { locale } = useLocale();
  const cache = useSessionListCache();
  const filtering = selected.size < profiles.length;

  return (
    <DropdownMenu modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={dict.shell.sidebar.filterByProfile}
              className={cn(
                "flex h-6 shrink-0 cursor-pointer items-center gap-1 border px-1.5 font-mono text-[10px] transition-colors",
                filtering
                  ? "border-border bg-primary-soft text-primary-ink"
                  : "border-transparent text-muted-foreground hover:border-border hover:bg-bg-elevated hover:text-foreground",
              )}
            >
              <ListFilter className="size-3.5" />
              {/* The count only appears while a filter is actually narrowing
               * the list — a badge reading "3 of 3" is noise. */}
              {filtering && selected.size}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{dict.shell.sidebar.filterByProfile}</TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="end" className="min-w-56">
        <div className="flex items-center gap-2 px-2 pt-1.5 pb-1">
          <span className="flex-1 font-mono text-[9.5px] tracking-[0.12em] text-text-faint uppercase">
            {dict.shell.sidebar.filterHeading}
          </span>
          <button
            type="button"
            onClick={onSelectAll}
            disabled={!filtering}
            className="cursor-pointer font-mono text-[10px] text-text-faint transition-colors hover:text-foreground disabled:cursor-default disabled:opacity-40"
          >
            {dict.shell.sidebar.allProfiles}
          </button>
        </div>

        {profiles.map((profile) => {
          const checked = selected.has(profile.id);
          const syncedAt = cache[profile.id]?.syncedAt ?? null;

          return (
            <button
              key={profile.id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={checked}
              // Not a `DropdownMenuCheckboxItem`: Radix closes the menu on
              // select, and picking several profiles in a row is the normal
              // way to use this. Staying open is the behaviour, not an
              // oversight.
              onClick={() => onToggle(profile.id)}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2.5 px-2 py-1.5 text-left transition-colors hover:bg-surface-hover",
                !checked && "opacity-55",
              )}
            >
              <span
                className={cn(
                  "size-2.5 shrink-0 border transition-colors",
                  checked ? cn("border-transparent", profileColorClass(profile.id)) : "border-border",
                )}
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-mono text-xs text-foreground">{profile.label}</span>
                {/* Decision made when the list stopped being per-profile:
                 * only the active profile has a live socket, so every other
                 * row is showing data of unknown age. That has to be visible,
                 * not implied. */}
                <span className="truncate font-mono text-[10px] text-text-faint">
                  {syncedAt === null
                    ? dict.shell.sidebar.neverSynced
                    : dict.shell.sidebar.syncedAt.replace("{time}", formatRelativeTime(syncedAt, locale))}
                </span>
              </span>
            </button>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
