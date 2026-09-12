import { cn } from "@/lib/utils";
import { useDict } from "@/i18n";

const ROW_WIDTHS = ["w-40", "w-32", "w-48", "w-28", "w-36", "w-44"];

/**
 * Stands in for the session list while the first sync is loading — same
 * shape as `MessageLogSkeleton.tsx` (`role="status"`, `aria-label`,
 * `aria-hidden` children, pulsing bars).
 *
 * Only shown when there is genuinely nothing to show: once a profile has
 * been synced on this device its rows are cached, and a later sync updates
 * them in place rather than replacing a usable list with pulsing bars.
 */
export function SessionListSkeleton({ size = "default" }: { size?: "default" | "lg" }) {
  const dict = useDict();
  return (
    <div
      className={cn("flex flex-col gap-2.5", size === "lg" ? "px-1 py-2" : "px-3 py-3")}
      role="status"
      aria-label={dict.shell.sidebar.loadingSessions}
    >
      {ROW_WIDTHS.map((width, i) => (
        <div key={i} aria-hidden="true" className={cn("h-3 animate-pulse bg-border", width)} />
      ))}
    </div>
  );
}
