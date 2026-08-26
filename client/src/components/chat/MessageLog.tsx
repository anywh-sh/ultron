import { memo, useEffect, useMemo, useRef } from "react";
import { LogEntryRow } from "@/components/chat/LogEntryRow";
import { UserBubble, AssistantText } from "@/components/chat/Message";
import { ToolCallCard } from "@/components/chat/ToolCallCard";
import { ErrorMessage } from "@/components/chat/ErrorMessage";
import { cn } from "@/lib/utils";
import type { LogEntry } from "@/hooks/useMessageLog";

interface MessageLogProps {
  entries: LogEntry[];
  streamingEntries: LogEntry[];
  /** Espaço extra no rodapé — no iOS, o composer flutua por cima do log
   * (docs/24), então o conteúdo precisa de mais respiro pra não terminar
   * escondido atrás dele. */
  className?: string;
}

type RenderItem =
  | { kind: "single"; entry: LogEntry }
  | { kind: "tool"; use: Extract<LogEntry, { kind: "tool-use" }>; result?: Extract<LogEntry, { kind: "tool-result" }> };

/** Junta tool-use com o tool-result correspondente (por toolUseId) num só
 * card — o reducer guarda os dois como entradas separadas, a apresentação
 * decide juntar. */
function pairToolEntries(entries: LogEntry[]): RenderItem[] {
  const resultByToolUseId = new Map<string, Extract<LogEntry, { kind: "tool-result" }>>();
  for (const entry of entries) {
    if (entry.kind === "tool-result" && entry.toolUseId) resultByToolUseId.set(entry.toolUseId, entry);
  }

  const items: RenderItem[] = [];
  for (const entry of entries) {
    if (entry.kind === "tool-result") continue;
    if (entry.kind === "tool-use") {
      items.push({ kind: "tool", use: entry, result: entry.toolUseId ? resultByToolUseId.get(entry.toolUseId) : undefined });
      continue;
    }
    items.push({ kind: "single", entry });
  }
  return items;
}

function renderItem(item: RenderItem) {
  if (item.kind === "tool") {
    return (
      <LogEntryRow key={item.use.id} rail="neutral">
        <ToolCallCard use={item.use} result={item.result} />
      </LogEntryRow>
    );
  }

  const entry = item.entry;
  switch (entry.kind) {
    case "user":
      return <UserBubble key={entry.id} text={entry.text} images={entry.images} />;
    case "text":
      return (
        <LogEntryRow key={entry.id} rail="none">
          <AssistantText text={entry.text} />
        </LogEntryRow>
      );
    case "error":
      return (
        <LogEntryRow key={entry.id} rail="error">
          <ErrorMessage message={entry.message} />
        </LogEntryRow>
      );
    case "stopped":
      return (
        <LogEntryRow key={entry.id} rail="none">
          <p className="text-xs text-muted-foreground">Interrompido pelo usuário.</p>
        </LogEntryRow>
      );
    default:
      return null;
  }
}

// Memoized: `ChatPanel` itself isn't memoized (its callback props are fresh
// closures from `App`'s `renderPanel` on every render), so it re-renders on
// any App-level state change — including for background tabs kept mounted
// via TabBar's `forceMount` (docs/18). `entries`/`streamingEntries` stay
// referentially stable across those unrelated re-renders (see useMessageLog),
// so wrapping this in `memo` lets the expensive subtree (markdown parsing +
// syntax highlighting in every row) bail out instead of re-rendering along
// with `ChatPanel`.
export const MessageLog = memo(function MessageLog({ entries, streamingEntries, className }: MessageLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [entries.length, streamingEntries.length]);

  // `entries` só ganha uma referência nova quando algo é de fato commitado
  // (ver reducer em useMessageLog) — memoizar aqui evita recalcular o
  // pareamento tool-use/tool-result (e, mais importante, recriar os
  // elementos `<ToolCallCard>`/`<AssistantText>` com identidade nova) a cada
  // token do streaming, quando só `streamingEntries` muda.
  const items = useMemo(() => pairToolEntries(entries), [entries]);

  return (
    // `relative` não é sobre layout — é o fix pro bug real do WebKit
    // (docs/24, reproduzido via Playwright WebKit real, não Chromium):
    // `backdrop-filter` num ancestral não sampleia o conteúdo desta div se
    // ela (ou qualquer ancestral entre ela e o elemento com o blur) ficar
    // `position: static`. Toda a cadeia até `.mobile-canvas` precisa disso
    // — ver App.tsx (wrappers de tab) e MobileShell.tsx. Não remover.
    <div className={cn("scrollbar-thin relative flex flex-1 flex-col gap-1 overflow-y-auto px-4 py-3", className)}>
      {items.map(renderItem)}
      {streamingEntries.map((entry) => renderItem({ kind: "single", entry }))}
      <div ref={bottomRef} />
    </div>
  );
});
