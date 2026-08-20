import { useState } from "react";
import {
  ChevronRight,
  FileText,
  FilePlus2,
  Pencil,
  Terminal,
  FolderSearch,
  Search,
  Globe,
  Bot,
  ListTodo,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DiffView } from "@/components/chat/DiffView";
import type { LogEntry } from "@/hooks/useMessageLog";

const ICON_BY_TOOL: Record<string, LucideIcon> = {
  Read: FileText,
  Write: FilePlus2,
  Edit: Pencil,
  Bash: Terminal,
  Glob: FolderSearch,
  Grep: Search,
  WebFetch: Globe,
  WebSearch: Globe,
  Task: Bot,
  TodoWrite: ListTodo,
};

interface ToolCallCardProps {
  use: Extract<LogEntry, { kind: "tool-use" }>;
  result?: Extract<LogEntry, { kind: "tool-result" }>;
}

function summaryFor(use: ToolCallCardProps["use"]): string | undefined {
  const input = use.input;
  if (!input) return undefined;
  if (use.name === "Bash" && typeof input.command === "string") return input.command;
  if (typeof input.file_path === "string") return input.file_path;
  if (typeof input.description === "string") return input.description;
  return undefined;
}

export function ToolCallCard({ use, result }: ToolCallCardProps) {
  const [open, setOpen] = useState(false);
  const Icon = ICON_BY_TOOL[use.name] ?? Wrench;
  const summary = summaryFor(use);
  const isError = result?.isError === true;

  return (
    <div className={cn("rounded-md border bg-card", isError ? "border-destructive/40" : "border-border")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left text-xs"
      >
        <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-mono font-medium text-foreground">{use.name}</span>
        {summary && <span className="truncate text-muted-foreground">{summary}</span>}
      </button>

      {open && (
        <div className="border-t border-border-soft px-2.5 py-2 text-xs">
          {use.name === "Edit" && result?.structuredPatch ? (
            <DiffView hunks={result.structuredPatch} />
          ) : (
            <>
              {use.input && (
                <pre className="mb-2 overflow-x-auto text-muted-foreground">{JSON.stringify(use.input, null, 2)}</pre>
              )}
              {result && (
                <pre className={cn("overflow-x-auto whitespace-pre-wrap", isError ? "text-destructive" : "text-foreground")}>
                  {result.content}
                </pre>
              )}
              {!result && <p className="text-muted-foreground">executando…</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
