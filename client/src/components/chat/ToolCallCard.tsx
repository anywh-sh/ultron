import { memo, useState } from "react";
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
import { CodeLines } from "@/components/chat/CodeLines";
import { languageForPath } from "@/lib/codeLanguage";
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

function formatParamValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function summaryFor(use: ToolCallCardProps["use"]): string | undefined {
  const input = use.input;
  if (!input) return undefined;
  if (use.name === "Bash" && typeof input.command === "string") return input.command;
  if (typeof input.file_path === "string") return input.file_path;
  if (typeof input.description === "string") return input.description;
  return undefined;
}

/** Memoizado — ver comentário em `Message.tsx::UserBubble`. `use`/`result`
 * são os mesmos objetos do reducer de `useMessageLog` enquanto a entrada não
 * muda, então o `memo` bail-outa de verdade (não é só shallow-compare vazio)
 * durante o streaming de outras mensagens da conversa. */
export const ToolCallCard = memo(function ToolCallCard({ use, result }: ToolCallCardProps) {
  // Edit/Write já abrem direto — o conteúdo (diff ou arquivo novo) é o que
  // importa ver de cara, igual ao preview automático do Claude Code no
  // terminal, em vez de exigir mais um clique pra ver o que mudou.
  const [open, setOpen] = useState(() => use.name === "Edit" || use.name === "Write");
  const Icon = ICON_BY_TOOL[use.name] ?? Wrench;
  const summary = summaryFor(use);
  const isError = result?.isError === true;
  const language = languageForPath(typeof use.input?.file_path === "string" ? use.input.file_path : undefined);
  const writeContent = use.name === "Write" && typeof use.input?.content === "string" ? use.input.content : undefined;

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
            <>
              <DiffView hunks={result.structuredPatch} language={language} />
              {isError && <p className="mt-2 text-destructive">{result.content}</p>}
            </>
          ) : writeContent !== undefined ? (
            <>
              <CodeLines language={language} lines={writeContent.split("\n").map((text) => ({ text, kind: "add" as const }))} />
              {isError && result && <p className="mt-2 text-destructive">{result.content}</p>}
            </>
          ) : (
            <>
              {use.input && Object.keys(use.input).length > 0 && (
                <div className="mb-2 flex flex-col gap-0.5 font-mono">
                  {Object.entries(use.input).map(([key, value]) => (
                    <div key={key} className="flex gap-2">
                      <span className="shrink-0 text-muted-foreground">{key}:</span>
                      <span className="whitespace-pre-wrap break-all text-foreground">{formatParamValue(value)}</span>
                    </div>
                  ))}
                </div>
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
});
