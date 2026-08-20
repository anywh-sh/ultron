import { cn } from "@/lib/utils";
import type { StructuredPatchHunk } from "@/lib/relay-types";

interface DiffViewProps {
  hunks: StructuredPatchHunk[];
}

/** O relay já entrega o diff pronto (`tool_use_result.structuredPatch` do
 * Edit) — não precisamos computar diff no cliente, só colorir +/-. */
export function DiffView({ hunks }: DiffViewProps) {
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card font-mono text-xs">
      {hunks.map((hunk, hunkIndex) => (
        <div key={hunkIndex} className={hunkIndex > 0 ? "border-t border-border-soft" : undefined}>
          {hunk.lines.map((line, lineIndex) => {
            const marker = line.charAt(0);
            return (
              <div
                key={lineIndex}
                className={cn(
                  "px-2 py-0.5 whitespace-pre",
                  marker === "+" && "bg-primary/10 text-primary",
                  marker === "-" && "bg-destructive/10 text-destructive",
                  marker !== "+" && marker !== "-" && "text-muted-foreground",
                )}
              >
                {line}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
