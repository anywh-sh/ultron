import { memo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolCallCard } from "@/components/chat/ToolCallCard";
import type { LogEntry } from "@/hooks/useMessageLog";

export type ToolPair = {
  use: Extract<LogEntry, { kind: "tool-use" }>;
  result?: Extract<LogEntry, { kind: "tool-result" }>;
};

interface ToolCallGroupProps {
  items: ToolPair[];
}

/** Collapses a contiguous sequence of silent tool calls (see
 * `MessageLog.tsx::buildRenderItems`) into a single item, same 2-level
 * pattern as Claude Desktop/VS Code: closed shows just the count, open
 * lists each `ToolCallCard` with its own individual collapse. */
export const ToolCallGroup = memo(function ToolCallGroup({ items }: ToolCallGroupProps) {
  const [open, setOpen] = useState(false);
  const pending = items.some((item) => !item.result);

  return (
    <div className="rounded-md border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left text-xs"
      >
        <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <span className="text-muted-foreground">
          {pending ? "Usando" : "Usou"} {items.length} ferramentas
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-1 border-t border-border-soft p-1.5">
          {items.map((item) => (
            <ToolCallCard key={item.use.id} use={item.use} result={item.result} />
          ))}
        </div>
      )}
    </div>
  );
});
