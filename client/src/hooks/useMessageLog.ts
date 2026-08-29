import { useMemo, useReducer } from "react";
import type { ClaudeEvent, ClaudeContentBlock, HistoryMessage, HistoryPageMessage, StructuredPatchHunk } from "@/lib/relay-types";
import type { PendingImage } from "@/hooks/useImageUpload";

export type LogEntry =
  | { kind: "user"; id: string; text: string; images?: PendingImage[]; sentAt: number }
  | { kind: "text"; id: string; text: string; streaming: boolean }
  | { kind: "tool-use"; id: string; toolUseId?: string; name: string; input: ClaudeContentBlock["input"] }
  | {
      kind: "tool-result";
      id: string;
      toolUseId?: string;
      content: string;
      isError: boolean;
      structuredPatch?: StructuredPatchHunk[];
    }
  | { kind: "error"; id: string; message: string }
  | { kind: "stopped"; id: string }
  /** Turno de follow-up automático de um job `ultron-bg` que terminou
   * (docs/32, Fase D/E) — o prompt sintético em si nunca vira bolha de
   * usuário (o texto é uma instrução interna, não algo que o usuário
   * digitou); isso é só a nota indicando de onde a resposta seguinte veio,
   * mesmo padrão de "stopped" (nota de sistema, sem bolha). */
  | { kind: "background-job-note"; id: string; label: string };

interface StreamingTextBlock {
  index: number;
  text: string;
}

interface MessageLogState {
  entries: LogEntry[];
  streamingText: StreamingTextBlock[];
  /** Se existem turnos mais antigos que `historyCursor` pra buscar via
   * `load_older_history` (Fase 2-4, docs/30). `false` até a cauda inicial
   * chegar (`HYDRATE`) — mesmo valor default de antes dessa feature existir
   * (sessão sem histórico nenhum pra paginar). */
  hasMoreHistory: boolean;
  /** Posição (no `history` do relay) da página mais antiga já carregada —
   * `null` até `HYDRATE`. É o que se manda de volta como `beforeCursor` pra
   * pedir a próxima página, mais antiga. */
  historyCursor: number | null;
  /** Pedido de página mais antiga em voo — guarda contra pedido duplicado
   * (Fase 5, UI: scroll pra cima dispara `beginLoadingOlderHistory` antes de
   * chamar `loadOlderHistory` no relay). */
  loadingOlderHistory: boolean;
}

type Action =
  | { type: "USER_MESSAGE"; text: string; images?: PendingImage[]; sentAt: number }
  /** Edição de mensagem (docs/33) — trunca `entries` até (exclusive) a
   * entry `id` (mensagem editada e tudo que veio depois, na tela deste
   * dispositivo) e empurra a nova, otimista, igual `USER_MESSAGE`. O relay
   * faz o corte de verdade (transcript real + `history` em memória) de
   * forma assíncrona; isso aqui só antecipa a UI local, mesmo espírito do
   * resto do reducer. */
  | { type: "EDIT_USER_MESSAGE"; id: string; text: string; sentAt: number }
  | { type: "CLAUDE_EVENT"; event: ClaudeEvent }
  | { type: "TURN_ERROR"; message: string }
  | { type: "TURN_COMPLETE"; stopped?: boolean }
  | { type: "RESET" }
  /** Cauda inicial recebida via `history_page` (Fase 2/3, docs/30) — troca o
   * replay antigo (um dispatch por evento, O(n²) de cópia de `entries`) por
   * um dispatch só que já entrega o estado final. */
  | { type: "HYDRATE"; messages: HistoryMessage[]; cursor: number; hasMore: boolean }
  | { type: "REQUEST_OLDER_HISTORY" }
  /** Resposta a `load_older_history` (Fase 5, docs/30) — turnos mais antigos
   * que `historyCursor`, inseridos no início do log. */
  | { type: "PREPEND_HISTORY"; messages: HistoryMessage[]; cursor: number; hasMore: boolean };

const initialState: MessageLogState = {
  entries: [],
  streamingText: [],
  hasMoreHistory: false,
  historyCursor: null,
  loadingOlderHistory: false,
};

function newId(): string {
  return crypto.randomUUID();
}

function commitContentBlock(entries: LogEntry[], block: ClaudeContentBlock): void {
  if (block.type === "text" && typeof block.text === "string") {
    // Marcador sintético que a própria CLI insere na transcrição ao ser
    // interrompida (`[Request interrupted by user]`, `[...for tool use]`,
    // `[...by a plugin for tool use]`) — não é conteúdo real do assistente.
    // O `stopped` de TURN_COMPLETE já cobre esse aviso ("Interrompido pelo
    // usuário."), então comitar isso também duplicava a mensagem na tela.
    if (block.text.startsWith("[Request interrupted")) return;
    entries.push({ kind: "text", id: newId(), text: block.text, streaming: false });
  } else if (block.type === "tool_use") {
    entries.push({
      kind: "tool-use",
      id: newId(),
      toolUseId: block.id as string | undefined,
      name: block.name ?? "tool",
      input: block.input,
    });
  } else if (block.type === "tool_result") {
    entries.push({
      kind: "tool-result",
      id: newId(),
      toolUseId: block.tool_use_id,
      content: typeof block.content === "string" ? block.content : JSON.stringify(block.content),
      isError: block.is_error === true,
    });
  }
  // "thinking" (o texto quase sempre vem vazio nos eventos reais — ver
  // docs/18) e outros tipos de bloco não têm representação visual no log;
  // o indicador de turno em andamento (acima do composer) cobre esse tempo.
}

/** Aplica um único `ClaudeEvent` — extraído do antigo `case "CLAUDE_EVENT"`
 * pra ser reaproveitado tanto pelo dispatch ao vivo (`handleEvent`, um de
 * cada vez) quanto pela hidratação em lote (`applyHistoryMessage`, dobrando
 * uma página inteira nessa mesma função). `user_prompt` é sintético: só
 * existe na reconstrução de histórico do `.jsonl` (relay/src/
 * transcriptReader.ts) ou no broadcast pro segundo dispositivo conectado ao
 * vivo (relay/src/sharedSession.ts::runTurn, docs/30 Fase 1) — o protocolo
 * nunca confunde isso com nada real. Um `user_prompt` marcado
 * `synthetic: "background_job"` (relay/src/sharedSession.ts::runTurn,
 * docs/32 Fase D) é um segundo tipo de sintético, gerado pelo follow-up
 * automático de um job `ultron-bg` — vira uma nota de sistema, não uma
 * bolha de usuário (ver comentário do `kind: "background-job-note"`). */
function applyClaudeEvent(state: MessageLogState, event: ClaudeEvent): MessageLogState {
  if (event.type === "user_prompt") {
    if (event.synthetic === "background_job") {
      const label = typeof event.label === "string" ? event.label : "job em background";
      return { ...state, entries: [...state.entries, { kind: "background-job-note", id: newId(), label }] };
    }
    const block = event.message?.content?.[0];
    const text = block?.type === "text" ? block.text : undefined;
    if (typeof text !== "string") return state;
    // `event.timestamp` só vem preenchido em replay/histórico ou no
    // broadcast pros OUTROS dispositivos (docs/33) — quem mandou a mensagem
    // já commitou ela via `USER_MESSAGE` com a hora local do clique, nunca
    // passa por aqui pra ela mesma. `Date.now()` de fallback só cobriria um
    // formato de evento inesperado, não deveria acontecer na prática.
    const sentAt = event.timestamp ? Date.parse(event.timestamp) : Date.now();
    return { ...state, entries: [...state.entries, { kind: "user", id: newId(), text, sentAt }] };
  }

  if (event.type === "stream_event" && event.event) {
    const se = event.event;
    if (se.type === "message_start") {
      return { ...state, streamingText: [] };
    }
    if (se.type === "content_block_start" && se.content_block.type === "text") {
      return {
        ...state,
        streamingText: [...state.streamingText.filter((b) => b.index !== se.index), { index: se.index, text: "" }],
      };
    }
    if (se.type === "content_block_delta" && se.delta.type === "text_delta") {
      const index = se.index;
      const chunk = se.delta.text;
      return {
        ...state,
        streamingText: state.streamingText.map((b) => (b.index === index ? { ...b, text: b.text + chunk } : b)),
      };
    }
    return state;
  }

  if (event.type === "assistant" || event.type === "user") {
    const entries = [...state.entries];
    for (const block of event.message?.content ?? []) {
      commitContentBlock(entries, block);
      // Enriquece o tool-result mais recente com o structuredPatch, se vier
      // (achado do pré-passo: o relay já entrega o diff pronto do Edit).
      if (block.type === "tool_result" && event.tool_use_result?.structuredPatch) {
        const last = entries[entries.length - 1];
        if (last && last.kind === "tool-result") last.structuredPatch = event.tool_use_result.structuredPatch;
      }
    }
    return { ...state, entries, streamingText: [] };
  }

  return state;
}

/** Aplica uma entrada de `history_page`/`older_history` (`HistoryMessage`,
 * mesmo formato de `relay/src/sharedSession.ts::BroadcastMessage`) — a
 * mesma máquina de estados de `applyClaudeEvent`, só que também cobre
 * `turn_complete`/`turn_error`, que fecham um turno (ver comentário original
 * em `TURN_COMPLETE` sobre texto parcial interrompido). Reaproveitada por
 * `HYDRATE` (dobra uma página inteira a partir do zero) e `PREPEND_HISTORY`
 * (idem, resultado inserido antes do que já existe). */
function applyHistoryMessage(state: MessageLogState, message: HistoryMessage): MessageLogState {
  if (message.type === "claude_event") return applyClaudeEvent(state, message.event);

  if (message.type === "turn_error") {
    return {
      ...state,
      entries: [...state.entries, { kind: "error", id: newId(), message: message.message }],
      streamingText: [],
    };
  }

  // turn_complete — parar no meio do streaming corta antes do evento
  // `assistant` final que normalmente comita o texto em `entries`; sem isso
  // o texto parcial (que só existia em `streamingText`, preview ao vivo)
  // simplesmente sumiria da tela ao marcar o turno como concluído.
  const entries = [...state.entries];
  for (const block of state.streamingText) {
    if (block.text.length > 0) entries.push({ kind: "text", id: newId(), text: block.text, streaming: false });
  }
  if (message.stopped) entries.push({ kind: "stopped", id: newId() });
  return { ...state, entries, streamingText: [] };
}

function reducer(state: MessageLogState, action: Action): MessageLogState {
  switch (action.type) {
    case "USER_MESSAGE":
      return {
        ...state,
        entries: [...state.entries, { kind: "user", id: newId(), text: action.text, images: action.images, sentAt: action.sentAt }],
      };

    case "EDIT_USER_MESSAGE": {
      const index = state.entries.findIndex((entry) => entry.id === action.id);
      // Não deveria acontecer (o id vem de uma entry renderizada agora
      // mesmo), mas se o log mudou debaixo do usuário por algum motivo,
      // trata como um envio normal em vez de arriscar truncar no lugar
      // errado — mais seguro que silenciosamente cortar tudo (`index: -1`
      // fatiaria o array inteiro).
      const base = index === -1 ? state.entries : state.entries.slice(0, index);
      return {
        ...state,
        entries: [...base, { kind: "user", id: newId(), text: action.text, sentAt: action.sentAt }],
        streamingText: [],
      };
    }

    case "CLAUDE_EVENT":
      return applyHistoryMessage(state, { type: "claude_event", event: action.event });

    case "TURN_ERROR":
      return applyHistoryMessage(state, { type: "turn_error", message: action.message });

    case "TURN_COMPLETE":
      return applyHistoryMessage(state, { type: "turn_complete", stopped: action.stopped });

    // Reconexão (docs/23, Fase D1) — o relay reenvia a cauda do histórico a
    // cada conexão nova, então o log precisa voltar vazio (inclusive o
    // cursor/hasMore de paginação) pra receber a hidratação sem duplicar o
    // que já estava na tela.
    case "RESET":
      return initialState;

    case "HYDRATE": {
      let next: MessageLogState = initialState;
      for (const message of action.messages) next = applyHistoryMessage(next, message);
      return { ...next, hasMoreHistory: action.hasMore, historyCursor: action.cursor, loadingOlderHistory: false };
    }

    case "REQUEST_OLDER_HISTORY":
      return { ...state, loadingOlderHistory: true };

    case "PREPEND_HISTORY": {
      // Calculado a partir do zero (não de `state`): é uma página estritamente
      // anterior ao que já está na tela, processá-la em cima do `state` atual
      // misturaria o `streamingText` de agora (turno ao vivo em andamento,
      // se houver) com conteúdo do passado — o `entries` resultante entra
      // antes do que já existe, o `streamingText` de agora fica intocado.
      let prefix: MessageLogState = initialState;
      for (const message of action.messages) prefix = applyHistoryMessage(prefix, message);
      return {
        ...state,
        entries: [...prefix.entries, ...state.entries],
        hasMoreHistory: action.hasMore,
        historyCursor: action.cursor,
        loadingOlderHistory: false,
      };
    }

    default:
      return state;
  }
}

export interface UseMessageLogResult {
  entries: LogEntry[];
  streamingEntries: LogEntry[];
  /** Se existem turnos mais antigos que `historyCursor` pra buscar (Fase 5,
   * docs/30) — UI usa isso pra saber se ainda reage a rolar pro topo. */
  hasMoreHistory: boolean;
  /** `null` até a cauda inicial chegar (`hydrate`) — depois disso, é o que
   * se manda pro relay via `loadOlderHistory(historyCursor)`. */
  historyCursor: number | null;
  /** Pedido de página mais antiga em voo — ver `beginLoadingOlderHistory`. */
  loadingOlderHistory: boolean;
  addUserMessage: (text: string, images?: PendingImage[]) => void;
  /** Edição de mensagem (docs/33) — trunca localmente (otimista) até a
   * mensagem `id` e empurra a nova em cima. O relay client é quem
   * efetivamente manda `edit_message` pro relay; isso aqui só atualiza a
   * tela deste dispositivo, mesmo padrão de `addUserMessage`/`sendMessage`
   * em `ChatPanel.onSend`. */
  editUserMessage: (id: string, text: string) => void;
  handleEvent: (event: ClaudeEvent) => void;
  handleTurnError: (message: string) => void;
  handleTurnComplete: (stopped?: boolean) => void;
  reset: () => void;
  /** Hidrata o log com a cauda inicial recebida via `history_page` (Fase
   * 2-4, docs/30) — chamado uma vez por conexão, no lugar do replay
   * evento-a-evento antigo. */
  hydrate: (page: HistoryPageMessage) => void;
  /** Marca que um pedido de turnos mais antigos está em voo — chamar antes
   * de disparar `loadOlderHistory` no relay (Fase 5, UI), evita pedido
   * duplicado enquanto a resposta não chega. */
  beginLoadingOlderHistory: () => void;
  /** Insere no início do log a resposta de um `load_older_history` (Fase 5,
   * docs/30). */
  prependHistory: (page: HistoryPageMessage) => void;
}

export function useMessageLog(): UseMessageLogResult {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Memoizado por `state.streamingText`: sem isso, cada render do consumidor
  // (ex: o `turnInFlight` do ChatPanel mudando) recriava esse array com
  // objetos novos, quebrando o bail-out do `React.memo` nos itens do log.
  const streamingEntries: LogEntry[] = useMemo(
    () =>
      state.streamingText
        .filter((b) => b.text.length > 0)
        .map((b) => ({ kind: "text" as const, id: `streaming-${b.index}`, text: b.text, streaming: true })),
    [state.streamingText],
  );

  return {
    entries: state.entries,
    streamingEntries,
    hasMoreHistory: state.hasMoreHistory,
    historyCursor: state.historyCursor,
    loadingOlderHistory: state.loadingOlderHistory,
    addUserMessage: (text, images) => dispatch({ type: "USER_MESSAGE", text, images, sentAt: Date.now() }),
    editUserMessage: (id, text) => dispatch({ type: "EDIT_USER_MESSAGE", id, text, sentAt: Date.now() }),
    handleEvent: (event) => dispatch({ type: "CLAUDE_EVENT", event }),
    handleTurnError: (message) => dispatch({ type: "TURN_ERROR", message }),
    handleTurnComplete: (stopped) => dispatch({ type: "TURN_COMPLETE", stopped }),
    reset: () => dispatch({ type: "RESET" }),
    hydrate: (page) => dispatch({ type: "HYDRATE", messages: page.messages, cursor: page.cursor, hasMore: page.hasMore }),
    beginLoadingOlderHistory: () => dispatch({ type: "REQUEST_OLDER_HISTORY" }),
    prependHistory: (page) =>
      dispatch({ type: "PREPEND_HISTORY", messages: page.messages, cursor: page.cursor, hasMore: page.hasMore }),
  };
}
