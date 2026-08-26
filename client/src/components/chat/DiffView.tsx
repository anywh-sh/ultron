import { CodeLines, type CodeLine } from "@/components/chat/CodeLines";
import type { StructuredPatchHunk } from "@/lib/relay-types";

interface DiffViewProps {
  hunks: StructuredPatchHunk[];
  language: string;
}

function kindForMarker(marker: string): CodeLine["kind"] {
  if (marker === "+") return "add";
  if (marker === "-") return "del";
  return "context";
}

/** O relay já entrega o diff pronto (`tool_use_result.structuredPatch` do
 * Edit) — só achata os hunks numa lista de linhas (com um separador "⋯"
 * entre hunks não-contíguos) e delega a cor por linha + highlight de
 * linguagem + truncamento pro `CodeLines`. */
export function DiffView({ hunks, language }: DiffViewProps) {
  const lines: CodeLine[] = [];
  hunks.forEach((hunk, hunkIndex) => {
    if (hunkIndex > 0) lines.push({ kind: "gap", text: "" });
    for (const line of hunk.lines) {
      lines.push({ kind: kindForMarker(line.charAt(0)), text: line.slice(1) });
    }
  });

  return <CodeLines language={language} lines={lines} />;
}
