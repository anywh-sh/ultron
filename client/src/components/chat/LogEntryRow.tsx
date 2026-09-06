import { memo, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface LogEntryRowProps {
  /** "none" = no rail, flush-left text (assistant response — user feedback:
   * no side marker here, same as Claude Desktop). Tool call and error keep
   * the rail. */
  rail: "neutral" | "error" | "none";
  children: ReactNode;
  className?: string;
}

const RAIL_COLOR: Record<Exclude<LogEntryRowProps["rail"], "none">, string> = {
  neutral: "bg-border",
  error: "bg-destructive",
};

/** Memoized — see comment on `Message.tsx::UserBubble`. Without this, the
 * wrapper would reconcile (and the memoized child inside it would bail out
 * too late) on every `MessageLog` render, even with `children` unchanged. */
export const LogEntryRow = memo(function LogEntryRow({ rail, children, className }: LogEntryRowProps) {
  if (rail === "none") {
    return <div className={cn("py-1.5", className)}>{children}</div>;
  }

  return (
    <div className={cn("flex gap-3 py-1.5", className)}>
      <div className={cn("w-0.5 shrink-0 rounded-full", RAIL_COLOR[rail])} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
});
