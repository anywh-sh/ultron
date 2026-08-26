import { memo, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
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

function itemKey(item: RenderItem): string {
  return item.kind === "tool" ? item.use.id : item.entry.id;
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
  const parentRef = useRef<HTMLDivElement>(null);

  // `entries` só ganha uma referência nova quando algo é de fato commitado
  // (ver reducer em useMessageLog) — memoizar aqui evita recalcular o
  // pareamento tool-use/tool-result a cada token do streaming, quando só
  // `streamingEntries` muda.
  const items = useMemo(() => pairToolEntries(entries), [entries]);

  const allItems = useMemo<RenderItem[]>(
    () => [...items, ...streamingEntries.map((entry): RenderItem => ({ kind: "single", entry }))],
    [items, streamingEntries],
  );

  const getItemKey = useCallback((index: number) => itemKey(allItems[index]), [allItems]);

  // Virtualizado — conversas longas (centenas de tool calls/blocos de código
  // com syntax highlighting) ficavam pesadas mesmo com a memoização acima,
  // porque toda a lista continuava montada no DOM. `anchorTo: "end"` +
  // `measureElement` (altura dinâmica — os itens variam muito: bolha curta,
  // bloco de código longo, tool card expansível) mantêm o fim colado
  // enquanto a última mensagem cresce durante o streaming, igual ao
  // `scrollIntoView` antigo. `followOnAppend` é o que resolve o pedido do
  // usuário: só acompanha uma mensagem nova se o viewport já estava no fim
  // — se ele rolou pra cima lendo o histórico enquanto o agente trabalha, o
  // scroll não é puxado pra baixo à força (docs oficiais do
  // @tanstack/react-virtual, seção "chat"). `useFlushSync: false` é a
  // recomendação oficial pra evitar warning/custo extra no React 19.
  const virtualizer = useVirtualizer({
    count: allItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 88,
    getItemKey,
    anchorTo: "end",
    followOnAppend: true,
    scrollEndThreshold: 80,
    overscan: 8,
    useFlushSync: false,
  });

  // Abre a aba já no fim da conversa (equivalente ao scrollIntoView antigo
  // no primeiro mount) — dali em diante quem cuida de manter colado no fim
  // é o `anchorTo`/`followOnAppend` acima. Sem guard de "só uma vez": em
  // StrictMode (dev) o React desmonta e remonta o nó real do container logo
  // depois do primeiro disparo pra testar limpeza de efeitos — um guard aqui
  // bloquearia a segunda chamada, que é a que roda no nó DOM final (a
  // primeira mira um nó descartado). `virtualizer` é uma instância estável
  // (não muda de identidade em re-renders normais), então em produção isso
  // roda só uma vez de verdade, igual ao padrão recomendado pela lib.
  useLayoutEffect(() => {
    virtualizer.scrollToEnd();
  }, [virtualizer]);

  return (
    // `relative` não é sobre layout — é o fix pro bug real do WebKit
    // (docs/24, reproduzido via Playwright WebKit real, não Chromium):
    // `backdrop-filter` num ancestral não sampleia o conteúdo desta div se
    // ela (ou qualquer ancestral entre ela e o elemento com o blur) ficar
    // `position: static`. Toda a cadeia até `.mobile-canvas` precisa disso
    // — ver App.tsx (wrappers de tab) e MobileShell.tsx. Não remover.
    <div ref={parentRef} className={cn("scrollbar-thin relative flex-1 overflow-y-auto px-4 py-3", className)}>
      <div style={{ position: "relative", width: "100%", height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const item = allItems[virtualItem.index];
          if (!item) return null;
          return (
            <div
              key={virtualItem.key}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                // Substitui o `gap-1` do layout flex antigo — os itens agora
                // são posicionados via `transform`, fora de fluxo, então o
                // espaçamento entre eles precisa vir de dentro de cada um.
                paddingBottom: "0.25rem",
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              {renderItem(item)}
            </div>
          );
        })}
      </div>
    </div>
  );
});
