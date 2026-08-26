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

// Só a primeira fatia aparece de cara — o resto fica atrás de "mostrar
// mais", igual ao preview truncado do Claude Code no terminal, em vez de
// despejar o arquivo/diff inteiro dentro do card.
const PREVIEW_LINE_COUNT = 14;

/** Lista de linhas de código coloridas por linguagem (Edit/Write no
 * `ToolCallCard`) — reaproveitada tanto pro diff do Edit (`DiffView`) quanto
 * pro conteúdo novo do Write (tratado como "tudo adicionado"). */
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
              line.kind === "add" && "bg-primary/10",
              line.kind === "del" && "bg-destructive/10",
            )}
          >
            <span
              className={cn(
                "mr-1 shrink-0 select-none",
                line.kind === "add" && "text-primary",
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
