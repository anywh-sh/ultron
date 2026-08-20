import { useReducer } from "react";
import type { ClaudeEvent, ClaudeContentBlock, StructuredPatchHunk } from "@/lib/relay-types";
import type { PendingImage } from "@/hooks/useImageUpload";

export type LogEntry =
  | { kind: "user"; id: string; text: string; images?: PendingImage[] }
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
  | { kind: "stopped"; id: string };

interface StreamingTextBlock {
  index: number;
  text: string;
}

interface MessageLogState {
  entries: LogEntry[];
  streamingText: StreamingTextBlock[];
}

type Action =
  | { type: "USER_MESSAGE"; text: string; images?: PendingImage[] }
  | { type: "CLAUDE_EVENT"; event: ClaudeEvent }
  | { type: "TURN_ERROR"; message: string }
  | { type: "TURN_COMPLETE"; stopped?: boolean };

const initialState: MessageLogState = { entries: [], streamingText: [] };

function newId(): string {
  return crypto.randomUUID();
}

function commitContentBlock(entries: LogEntry[], block: ClaudeContentBlock): void {
  if (block.type === "text" && typeof block.text === "string") {
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

function reducer(state: MessageLogState, action: Action): MessageLogState {
  switch (action.type) {
    case "USER_MESSAGE":
      return {
        ...state,
        entries: [...state.entries, { kind: "user", id: newId(), text: action.text, images: action.images }],
      };

    case "CLAUDE_EVENT": {
      const { event } = action;

      // Sintético, só existe na reconstrução de histórico a partir do
      // `.jsonl` (relay/src/transcriptReader.ts) — o protocolo ao vivo nunca
      // manda de volta o texto que o próprio usuário digitou, então não tem
      // como confundir com nada real (ver docs/20-backlog.md).
      if (event.type === "user_prompt") {
        const block = event.message?.content?.[0];
        const text = block?.type === "text" ? block.text : undefined;
        if (typeof text !== "string") return state;
        return { ...state, entries: [...state.entries, { kind: "user", id: newId(), text }] };
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

    case "TURN_ERROR":
      return {
        ...state,
        entries: [...state.entries, { kind: "error", id: newId(), message: action.message }],
        streamingText: [],
      };

    case "TURN_COMPLETE": {
      // Parar no meio do streaming corta antes do evento `assistant` final
      // que normalmente comita o texto em `entries` — sem isso o texto
      // parcial, que só existia em `streamingText` (preview ao vivo),
      // simplesmente sumiria da tela ao marcar o turno como concluído.
      const entries = [...state.entries];
      for (const block of state.streamingText) {
        if (block.text.length > 0) entries.push({ kind: "text", id: newId(), text: block.text, streaming: false });
      }
      if (action.stopped) entries.push({ kind: "stopped", id: newId() });
      return { ...state, entries, streamingText: [] };
    }

    default:
      return state;
  }
}

export interface UseMessageLogResult {
  entries: LogEntry[];
  streamingEntries: LogEntry[];
  addUserMessage: (text: string, images?: PendingImage[]) => void;
  handleEvent: (event: ClaudeEvent) => void;
  handleTurnError: (message: string) => void;
  handleTurnComplete: (stopped?: boolean) => void;
}

export function useMessageLog(): UseMessageLogResult {
  const [state, dispatch] = useReducer(reducer, initialState);

  const streamingEntries: LogEntry[] = state.streamingText
    .filter((b) => b.text.length > 0)
    .map((b) => ({ kind: "text", id: `streaming-${b.index}`, text: b.text, streaming: true }));

  return {
    entries: state.entries,
    streamingEntries,
    addUserMessage: (text, images) => dispatch({ type: "USER_MESSAGE", text, images }),
    handleEvent: (event) => dispatch({ type: "CLAUDE_EVENT", event }),
    handleTurnError: (message) => dispatch({ type: "TURN_ERROR", message }),
    handleTurnComplete: (stopped) => dispatch({ type: "TURN_COMPLETE", stopped }),
  };
}
