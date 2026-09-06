import { useState } from "react";
import { cn } from "@/lib/utils";
import { highlightCode } from "@/lib/highlightCode";

export interface CodeLine {
  text: string;
  kind: "add" | "del" | "context" | "gap";
}

interface CodeLinesProps {
  language: string;
  lines: CodeLine[];
}

const MARKER_BY_KIND: Record<CodeLine["kind"], string> = {
  add: "+",
  del: "-",
  context: " ",
  gap: "",
};

// Only the first slice shows up right away — the rest sits behind "show
// more", like the Claude Code CLI's truncated preview in the terminal,
// instead of dumping the whole file/diff into the card.
const PREVIEW_LINE_COUNT = 14;

/** List of code lines colored by language (Edit/Write in `ToolCallCard`) —
 * reused both for the Edit diff (`DiffView`) and for Write's new content
 * (treated as "everything added"). */
export function CodeLines({ language, lines }: CodeLinesProps) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? lines : lines.slice(0, PREVIEW_LINE_COUNT);
  const hiddenCount = lines.length - visible.length;

  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card font-mono text-xs">
      {visible.map((line, index) =>
        line.kind === "gap" ? (
          <div key={index} className="border-t border-border-soft px-2 py-0.5 text-muted-foreground/60">
            ⋯
          </div>
        ) : (
          <div
            key={index}
            className={cn(
              "flex px-2 py-0.5 whitespace-pre",
              line.kind === "add" && "bg-diff-add/10",
              line.kind === "del" && "bg-destructive/10",
            )}
          >
            <span
              className={cn(
                "mr-1 shrink-0 select-none",
                line.kind === "add" && "text-diff-add",
                line.kind === "del" && "text-destructive",
                line.kind === "context" && "text-muted-foreground",
              )}
            >
              {MARKER_BY_KIND[line.kind]}
            </span>
            <span>{highlightCode(language, line.text)}</span>
          </div>
        ),
      )}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full cursor-pointer border-t border-border-soft px-2 py-1 text-left text-muted-foreground hover:text-foreground"
        >
          Mostrar mais {hiddenCount} linhas
        </button>
      )}
    </div>
  );
}
