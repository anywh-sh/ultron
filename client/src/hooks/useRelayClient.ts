import { useCallback, useEffect, useRef, useState } from "react";
import { RelayClient, type ClaudeEvent, type PermissionMode } from "@/lib/relayClient";
import type { Profile } from "@/lib/profiles";

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

    const client = new RelayClient(profile.host, profile.relayPort, sessionId, {
      onEvent: (event) => optionsRef.current.onEvent?.(event),
      onTurnComplete: (stopped) => optionsRef.current.onTurnComplete?.(stopped),
      onTurnError: (message) => optionsRef.current.onTurnError?.(message),
      onCaughtUp: () => optionsRef.current.onCaughtUp?.(),
      onCwdState: (newCwd, locked) => {
        setCwdState(newCwd);
        setCwdLocked(locked);
      },
      onSetCwdError: (message) => optionsRef.current.onSetCwdError?.(message),
      onPermissionModeState: setPermissionModeState,
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

  return { connected, cwd, cwdLocked, permissionMode, sendMessage, stopTurn, setCwd, setPermissionMode };
}
