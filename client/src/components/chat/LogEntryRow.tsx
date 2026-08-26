import { memo, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface LogEntryRowProps {
  /** "none" = sem rail, texto flush-left (resposta do assistente — feedback
   * do usuário: sem marcação lateral aqui, igual ao Claude Desktop). Tool
   * call e erro mantêm a rail. */
  rail: "neutral" | "error" | "none";
  children: ReactNode;
  className?: string;
}

const RAIL_COLOR: Record<Exclude<LogEntryRowProps["rail"], "none">, string> = {
  neutral: "bg-border",
  error: "bg-destructive",
};

/** Memoizado — ver comentário em `Message.tsx::UserBubble`. Sem isso, o
 * wrapper reconciliava (e o filho memoizado dentro dele bail-outava tarde
 * demais) a cada render do `MessageLog`, mesmo com `children` inalterado. */
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
