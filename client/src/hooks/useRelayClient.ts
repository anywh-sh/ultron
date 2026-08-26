import { useCallback, useEffect, useRef, useState } from "react";
import { RelayClient, type ClaudeEvent, type ContextUsage, type PermissionMode } from "@/lib/relayClient";
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
  /** Ver `RelayClientCallbacks.onReconnecting` — dispara antes de todo
   * replay de histórico que não seja da conexão inicial. */
  onReconnecting?: () => void;
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
  /** `null` até o primeiro `context_usage_state` chegar — nunca chega numa
   * sessão nova sem nenhum turno concluído ainda (ver sharedSession.ts). */
  contextUsage: ContextUsage | null;
  /** Último `compact_boundary` visto, se houver — pensado pra um toast
   * transitório na UI, não estado persistente (ver `CompactBoundaryEvent`). */
  compactBoundary: CompactBoundaryEvent | null;
  sendMessage: (text: string) => void;
  stopTurn: () => void;
  setCwd: (path: string) => void;
  setPermissionMode: (mode: PermissionMode) => void;
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
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [compactBoundary, setCompactBoundary] = useState<CompactBoundaryEvent | null>(null);
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
    setContextUsage(null);
    setCompactBoundary(null);

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
      onContextUsageState: setContextUsage,
      onSessionTitle: (title) => optionsRef.current.onSessionTitle?.(title),
      onSessionDeleted: () => optionsRef.current.onSessionDeleted?.(),
      onConnectionChange: setConnected,
      onReconnecting: () => optionsRef.current.onReconnecting?.(),
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

  return {
    connected,
    cwd,
    cwdLocked,
    permissionMode,
    contextUsage,
    compactBoundary,
    sendMessage,
    stopTurn,
    setCwd,
    setPermissionMode,
  };
}
