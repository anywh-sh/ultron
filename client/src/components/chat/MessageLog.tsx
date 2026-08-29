import { memo, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { Loader2 } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { LogEntryRow } from "@/components/chat/LogEntryRow";
import { UserBubble, AssistantText } from "@/components/chat/Message";
import { ToolCallCard } from "@/components/chat/ToolCallCard";
import { ToolCallGroup, type ToolPair } from "@/components/chat/ToolCallGroup";
import { ErrorMessage } from "@/components/chat/ErrorMessage";
import { cn } from "@/lib/utils";
import type { LogEntry } from "@/hooks/useMessageLog";

interface MessageLogProps {
  entries: LogEntry[];
  streamingEntries: LogEntry[];
  /** Se existem turnos mais antigos que o que já está carregado (Fase 5,
   * docs/30) — controla se rolar perto do topo ainda dispara busca. */
  hasMoreHistory: boolean;
  /** Pedido de página mais antiga em voo — mostra o indicador no topo e
   * também guarda contra pedido duplicado (a mesma guarda já existe no
   * chamador, `ChatPanel`, mas checar aqui também evita reagir a scroll
   * repetido enquanto a resposta não chega). */
  loadingOlderHistory: boolean;
  /** Chamado quando o usuário rola perto do topo da lista, com mais
   * histórico ainda por buscar. */
  onLoadOlderHistory: () => void;
  /** Espaço extra no rodapé — no iOS, o composer flutua por cima do log
   * (docs/24), então o conteúdo precisa de mais respiro pra não terminar
   * escondido atrás dele. */
  className?: string;
}

type RenderItem =
  | { kind: "single"; entry: LogEntry }
  | ({ kind: "tool" } & ToolPair)
  | { kind: "tool-group"; items: ToolPair[] };

// Tools que nunca entram num grupo colapsado — cada uma merece destaque
// próprio: Edit/Write mutam disco (diff quer ser visto), TodoWrite é sinal
// de planejamento, e Task delega pra um subagent cujas sub-tool-calls são
// invisíveis no protocolo (não chegam como eventos separados), então o card
// é a única janela pra esse trabalho — não pode ficar enterrado num "Usou N
// ferramentas".
const UNGROUPABLE_TOOLS = new Set(["Edit", "Write", "TodoWrite", "Task"]);

function isGroupable(pair: ToolPair): boolean {
  if (pair.result?.isError) return false;
  return !UNGROUPABLE_TOOLS.has(pair.use.name);
}

/** Junta tool-use com o tool-result correspondente (por toolUseId), e
 * agrupa sequências contíguas de tool calls "silenciosas" (sem texto entre
 * elas) num único item colapsável — reflete como o Claude realmente age
 * (várias ações em fila) em vez de virar uma lista de cards soltos e
 * idênticos. O protocolo do CLI não expõe "turno" como unidade (só mensagens
 * `assistant`/`user`), e o replay de sessão salva também não reconstrói
 * fronteiras internas de turno — por isso o agrupamento é por adjacência no
 * log (contíguo = sem nenhum bloco de texto/erro no meio), não por turno:
 * funciona idêntico ao vivo e no replay, sem precisar de um conceito que o
 * protocolo não entrega. */
function buildRenderItems(entries: LogEntry[]): RenderItem[] {
  const resultByToolUseId = new Map<string, Extract<LogEntry, { kind: "tool-result" }>>();
  for (const entry of entries) {
    if (entry.kind === "tool-result" && entry.toolUseId) resultByToolUseId.set(entry.toolUseId, entry);
  }

  const items: RenderItem[] = [];
  let buffer: ToolPair[] = [];

  const flushBuffer = () => {
    if (buffer.length === 1) items.push({ kind: "tool", ...buffer[0] });
    else if (buffer.length > 1) items.push({ kind: "tool-group", items: buffer });
    buffer = [];
  };

  for (const entry of entries) {
    if (entry.kind === "tool-result") continue;
    if (entry.kind === "tool-use") {
      const pair: ToolPair = { use: entry, result: entry.toolUseId ? resultByToolUseId.get(entry.toolUseId) : undefined };
      if (isGroupable(pair)) {
        buffer.push(pair);
      } else {
        flushBuffer();
        items.push({ kind: "tool", ...pair });
      }
      continue;
    }
    flushBuffer();
    items.push({ kind: "single", entry });
  }
  flushBuffer();
  return items;
}

function itemKey(item: RenderItem): string {
  if (item.kind === "tool") return item.use.id;
  if (item.kind === "tool-group") return `group-${item.items[0].use.id}`;
  return item.entry.id;
}

function renderItem(item: RenderItem) {
  if (item.kind === "tool") {
    return (
      <LogEntryRow key={item.use.id} rail="neutral">
        <ToolCallCard use={item.use} result={item.result} />
      </LogEntryRow>
    );
  }

  if (item.kind === "tool-group") {
    return (
      <LogEntryRow key={`group-${item.items[0].use.id}`} rail="neutral">
        <ToolCallGroup items={item.items} />
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
    case "background-job-note":
      return (
        <LogEntryRow key={entry.id} rail="none">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3 shrink-0" />
            <span className="truncate">{entry.label} — finalizado, resumindo o resultado</span>
          </p>
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
export const MessageLog = memo(function MessageLog({
  entries,
  streamingEntries,
  hasMoreHistory,
  loadingOlderHistory,
  onLoadOlderHistory,
  className,
}: MessageLogProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // `entries` só ganha uma referência nova quando algo é de fato commitado
  // (ver reducer em useMessageLog) — memoizar aqui evita recalcular o
  // pareamento tool-use/tool-result a cada token do streaming, quando só
  // `streamingEntries` muda.
  const items = useMemo(() => buildRenderItems(entries), [entries]);

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

  // Scroll reverso (Fase 5, docs/30): guarda a altura total no instante em
  // que o pedido de turnos mais antigos é disparado — não dá pra saber de
  // antemão quando a resposta chega, então isso é o único momento confiável
  // pra capturar o "antes". `null` quando não há compensação em andamento.
  const prependAnchorRef = useRef<number | null>(null);

  const handleScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el || el.scrollTop > 120 || loadingOlderHistory || !hasMoreHistory) return;
    prependAnchorRef.current = virtualizer.getTotalSize();
    onLoadOlderHistory();
  }, [hasMoreHistory, loadingOlderHistory, onLoadOlderHistory, virtualizer]);

  // Achado testando com conteúdo de tamanho real (blocos de código, textos
  // longos): compensar o scroll uma única vez (na primeira mudança de altura
  // depois do prepend) não bastava — os itens novos entram com a altura
  // ESTIMADA (`estimateSize: 88`), `measureElement` só mede a de verdade de
  // forma assíncrona (ResizeObserver) depois que o DOM já pintou, e essa
  // correção de tamanho chega numa altura TOTAL diferente da que a gente já
  // tinha compensado — sem tratar isso, o scroll "chacoalha" (desce um
  // pouco, sobe de novo) enquanto as medições reais vão chegando. Por isso
  // este efeito roda em TODO render onde `totalSize` mudou (não só uma vez
  // por prepend) enquanto a âncora estiver ativa, e só solta a âncora depois
  // de ~300ms sem nenhuma mudança de tamanho — sinal de que as medições já
  // assentaram. A janela curta importa: manter a âncora presa por muito
  // tempo passaria a "corrigir" também um turno ao vivo crescendo no fim,
  // que `anchorTo`/`followOnAppend` já cuidam sozinhos.
  const totalSize = virtualizer.getTotalSize();
  const settleTimeoutRef = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current;
    const el = parentRef.current;
    if (anchor === null || !el) return;
    const delta = totalSize - anchor;
    if (delta !== 0) el.scrollTop += delta;
    prependAnchorRef.current = totalSize;

    window.clearTimeout(settleTimeoutRef.current);
    settleTimeoutRef.current = window.setTimeout(() => {
      prependAnchorRef.current = null;
    }, 300);

    return () => window.clearTimeout(settleTimeoutRef.current);
  }, [totalSize]);

  return (
    // `relative` não é sobre layout — é o fix pro bug real do WebKit
    // (docs/24, reproduzido via Playwright WebKit real, não Chromium):
    // `backdrop-filter` num ancestral não sampleia o conteúdo desta div se
    // ela (ou qualquer ancestral entre ela e o elemento com o blur) ficar
    // `position: static`. Toda a cadeia até `.mobile-canvas` precisa disso
    // — ver App.tsx (wrappers de tab) e MobileShell.tsx. Não remover.
    <div
      ref={parentRef}
      onScroll={handleScroll}
      className={cn("scrollbar-thin relative flex-1 overflow-y-auto px-4 py-3", className)}
    >
      {loadingOlderHistory && (
        <div className="sticky top-0 z-10 flex justify-center py-1.5">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      )}
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
