import { cn } from "@/lib/utils";

const ROW_WIDTHS = ["w-40", "w-32", "w-48", "w-28", "w-36", "w-44"];

/**
 * Stands in for the session list while `useSessionNames` is loading — same
 * shape as `MessageLogSkeleton.tsx` (`role="status"`, `aria-label`,
 * `aria-hidden` children, pulsing bars), so a profile switch shows this
 * instead of either an empty flash or, worse, the previous profile's
 * sessions for one frame.
 */
export function SessionListSkeleton({ size = "default" }: { size?: "default" | "lg" }) {
  return (
    <div
      className={cn("flex flex-col gap-2", size === "lg" ? "px-1 py-1" : "px-2 py-1.5")}
      role="status"
      aria-label="Carregando sessões…"
    >
      {ROW_WIDTHS.map((width, i) => (
        <div key={i} aria-hidden="true" className={cn("h-3 animate-pulse rounded-full bg-border", width)} />
      ))}
    </div>
  );
}
