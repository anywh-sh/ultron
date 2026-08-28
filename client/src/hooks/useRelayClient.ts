import { useCallback, useEffect, useRef, useState } from "react";
import {
  RelayClient,
  type ClaudeEvent,
  type ContextUsage,
  type HistoryPageMessage,
  type ModelChoice,
  type PermissionMode,
} from "@/lib/relayClient";
import type { Profile } from "@/lib/profiles";

/** Um `compact_boundary` recebido, com timestamp — o timestamp garante uma
 * referência nova a cada ocorrência (mesmo `trigger`/`preTokens` repetidos),
 * pra quem for mostrar um toast poder reagir via `useEffect` sem precisar
 * avisar o hook de volta que já mostrou. */
export interface CompactBoundaryEvent {
  trigger: "auto" | "manual";
  preTokens: number;
  receivedAt: number;
}

export interface UseRelayClientOptions {
  onEvent?: (event: ClaudeEvent) => void;
  onTurnComplete?: (stopped: boolean) => void;
  onTurnError?: (message: string) => void;
  onCaughtUp?: () => void;
  onSetCwdError?: (message: string) => void;
  onSessionTitle?: (title: string) => void;
  onSessionDeleted?: () => void;
  /** Resumo pra notificação chegando — ver `RelayClientCallbacks.onNotificationSummary`.
   * Passthrough puro (sem state interno): quem usa decide o que fazer, o hook
   * não precisa re-renderizar por causa disso. */
  onNotificationSummary?: (text: string | null) => void;
  /** Ver `RelayClientCallbacks.onReconnecting` — dispara antes de todo
   * replay de histórico que não seja da conexão inicial. */
  onReconnecting?: () => void;
  /** `/clear` (docs/26) — ver `RelayClientCallbacks.onConversationReset`. */
  onConversationReset?: () => void;
  /** Turno em andamento na sessão, não só de quem mandou — ver
   * `RelayClientCallbacks.onTurnState` (docs/30). Passthrough puro, mesmo
   * raciocínio de `onNotificationSummary`: `ChatPanel` já mantém o próprio
   * `turnStartedAt`, não precisa de state duplicado aqui. */
  onTurnState?: (state: { active: boolean; startedAt?: number }) => void;
  /** Cauda recente do histórico dessa sessão — ver
   * `RelayClientCallbacks.onHistoryPage` (Fase 2/3, docs/30). */
  onHistoryPage?: (page: HistoryPageMessage) => void;
  /** Resposta a `loadOlderHistory` — ver `RelayClientCallbacks.onOlderHistory`
   * (Fase 2/3, docs/30). */
  onOlderHistory?: (page: HistoryPageMessage) => void;
}

export interface UseRelayClientResult {
  connected: boolean;
  /** `null` só na janela breve entre conectar e o primeiro `cwd_state`
   * chegar — ver `SharedSession.addClient` no relay, que manda isso antes
   * de qualquer outra coisa. */
  cwd: string | null;
  cwdLocked: boolean;
  /** `null` só na janela breve entre conectar e o primeiro
   * `permission_mode_state` chegar — mesmo motivo do `cwd` acima. */
  permissionMode: PermissionMode | null;
  /** `null` tanto na janela breve entre conectar e o primeiro `model_state`
   * quanto no estado final "nunca escolhido via /model" — os dois se
   * comportam igual pra UI (usa o padrão do CLI), não precisa distinguir. */
  model: ModelChoice | null;
  /** Modelo padrão de verdade da conta desse perfil (docs/28) — fallback de
   * exibição pra quando `model` acima é `null`. `null` só na janela breve
   * antes da sondagem do relay terminar (ou se ela falhar). */
  defaultModel: string | null;
  /** `null` até o primeiro `context_usage_state` chegar — nunca chega numa
   * sessão nova sem nenhum turno concluído ainda (ver sharedSession.ts), e
   * volta a `null` depois de um `/clear` (docs/26). */
  contextUsage: ContextUsage | null;
  /** Último `compact_boundary` visto, se houver — pensado pra um toast
   * transitório na UI, não estado persistente (ver `CompactBoundaryEvent`). */
  compactBoundary: CompactBoundaryEvent | null;
  /** Sugestão de próxima mensagem, se houver — ver relay-types.ts. `null`
   * tanto "ainda sem sugestão" quanto "sugestão anterior não vale mais". */
  suggestion: string | null;
  /** Limpa a sugestão só localmente (sem round-trip) — o relay já vai limpar
   * a dele e broadcastar `null` assim que o `submitTurn` correspondente
   * chegar, mas isso tem uma latência de rede; quem envia uma mensagem já
   * sabe que a sugestão de agora não vale mais, então chama isso na hora
   * pra não arriscar o placeholder antigo reaparecer por uma fração de
   * segundo depois do composer ser limpo (mesmo espírito da atualização
   * otimista de `onActivity` em ChatPanel). */
  dismissSuggestion: () => void;
  sendMessage: (text: string) => void;
  stopTurn: () => void;
  setCwd: (path: string) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  setModel: (model: ModelChoice) => void;
  clearConversation: () => void;
  /** Busca turnos mais antigos que `beforeCursor` — ver
   * `RelayClient.loadOlderHistory` (Fase 2/3, docs/30). */
  loadOlderHistory: (beforeCursor: number) => void;
}

/**
 * Uma instância por aba aberta — inclusive abas em background, que ficam
 * montadas (ver TabBar/forceMount) pra manter o WebSocket vivo mesmo sem
 * foco, conforme docs/18. Callback-based: quem chama decide onde os eventos
 * vão parar (ex: o reducer de `useMessageLog`) em vez do hook acumular seu
 * próprio array duplicado.
 */
export function useRelayClient(
  profile: Profile,
  sessionId: string,
  options: UseRelayClientOptions = {},
): UseRelayClientResult {
  const [connected, setConnected] = useState(false);
  const [cwd, setCwdState] = useState<string | null>(null);
  const [cwdLocked, setCwdLocked] = useState(false);
  const [permissionMode, setPermissionModeState] = useState<PermissionMode | null>(null);
  const [model, setModelState] = useState<ModelChoice | null>(null);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [compactBoundary, setCompactBoundary] = useState<CompactBoundaryEvent | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const clientRef = useRef<RelayClient | null>(null);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    // Estado de working directory é por conexão — uma troca de aba/sessão
    // reconecta do zero, então começa "desconhecido" até o relay mandar o
    // primeiro `cwd_state` dessa sessão nova.
    setCwdState(null);
    setCwdLocked(false);
    setPermissionModeState(null);
    setModelState(null);
    setDefaultModel(null);
    setContextUsage(null);
    setCompactBoundary(null);
    setSuggestion(null);

    const client = new RelayClient(profile.host, profile.relayPort, sessionId, {
      onEvent: (event) => {
        // `compact_boundary` já atravessa o `claude_event` genérico sem
        // nenhum tratamento especial no relay — só intercepta aqui pra
        // alimentar o toast, sem tirar o evento do fluxo normal (useMessageLog
        // etc. continuam recebendo tudo como antes).
        if (event.type === "system" && event.subtype === "compact_boundary" && event.compactMetadata) {
          setCompactBoundary({ ...event.compactMetadata, receivedAt: Date.now() });
        }
        optionsRef.current.onEvent?.(event);
      },
      onTurnComplete: (stopped) => optionsRef.current.onTurnComplete?.(stopped),
      onTurnError: (message) => optionsRef.current.onTurnError?.(message),
      onCaughtUp: () => optionsRef.current.onCaughtUp?.(),
      onCwdState: (newCwd, locked) => {
        setCwdState(newCwd);
        setCwdLocked(locked);
      },
      onSetCwdError: (message) => optionsRef.current.onSetCwdError?.(message),
      onPermissionModeState: setPermissionModeState,
      onModelState: setModelState,
      onDefaultModelState: setDefaultModel,
      onContextUsageState: setContextUsage,
      onSuggestion: setSuggestion,
      onNotificationSummary: (text) => optionsRef.current.onNotificationSummary?.(text),
      onSessionTitle: (title) => optionsRef.current.onSessionTitle?.(title),
      onSessionDeleted: () => optionsRef.current.onSessionDeleted?.(),
      onConnectionChange: setConnected,
      onReconnecting: () => optionsRef.current.onReconnecting?.(),
      onConversationReset: () => optionsRef.current.onConversationReset?.(),
      onHistoryPage: (page) => optionsRef.current.onHistoryPage?.(page),
      onOlderHistory: (page) => optionsRef.current.onOlderHistory?.(page),
      onTurnState: (state) => optionsRef.current.onTurnState?.(state),
    });
    clientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [profile.host, profile.relayPort, sessionId]);

  // Reconexão em foreground/background (docs/23, Fase D1): `visibilitychange`
  // é o sinal confiável em iOS (Fase D0 confirmou que o onFocusChanged do
  // Tauri nunca dispara lá) — funciona igual em desktop, sem gate de
  // plataforma. `forceReconnect` já decide sozinho se a conexão atual
  // precisa mesmo ser recriada.
  useEffect(() => {
    function handleVisibilityChange(): void {
      if (document.visibilityState === "visible") clientRef.current?.forceReconnect();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  const sendMessage = useCallback((text: string) => {
    clientRef.current?.sendMessage(text);
  }, []);

  const stopTurn = useCallback(() => {
    clientRef.current?.stopTurn();
  }, []);

  const setCwd = useCallback((path: string) => {
    clientRef.current?.setCwd(path);
  }, []);

  const setPermissionMode = useCallback((mode: PermissionMode) => {
    clientRef.current?.setPermissionMode(mode);
  }, []);

  const setModel = useCallback((newModel: ModelChoice) => {
    clientRef.current?.setModel(newModel);
  }, []);

  const clearConversation = useCallback(() => {
    clientRef.current?.clearConversation();
  }, []);

  const dismissSuggestion = useCallback(() => {
    setSuggestion(null);
  }, []);

  const loadOlderHistory = useCallback((beforeCursor: number) => {
    clientRef.current?.loadOlderHistory(beforeCursor);
  }, []);

  return {
    connected,
    cwd,
    cwdLocked,
    permissionMode,
    model,
    defaultModel,
    contextUsage,
    compactBoundary,
    suggestion,
    dismissSuggestion,
    sendMessage,
    stopTurn,
    setCwd,
    setPermissionMode,
    setModel,
    clearConversation,
    loadOlderHistory,
  };
}
