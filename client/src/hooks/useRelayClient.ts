import { useCallback, useEffect, useRef, useState } from "react";
import { RelayClient, type ClaudeEvent } from "@/lib/relayClient";
import type { Profile } from "@/lib/profiles";

export interface UseRelayClientOptions {
  onEvent?: (event: ClaudeEvent) => void;
  onTurnComplete?: (stopped: boolean) => void;
  onTurnError?: (message: string) => void;
  onCaughtUp?: () => void;
  onSetCwdError?: (message: string) => void;
  onSessionTitle?: (title: string) => void;
}

export interface UseRelayClientResult {
  connected: boolean;
  /** `null` só na janela breve entre conectar e o primeiro `cwd_state`
   * chegar — ver `SharedSession.addClient` no relay, que manda isso antes
   * de qualquer outra coisa. */
  cwd: string | null;
  cwdLocked: boolean;
  sendMessage: (text: string) => void;
  stopTurn: () => void;
  setCwd: (path: string) => void;
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
  const clientRef = useRef<RelayClient | null>(null);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    // Estado de working directory é por conexão — uma troca de aba/sessão
    // reconecta do zero, então começa "desconhecido" até o relay mandar o
    // primeiro `cwd_state` dessa sessão nova.
    setCwdState(null);
    setCwdLocked(false);

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
      onSessionTitle: (title) => optionsRef.current.onSessionTitle?.(title),
      onConnectionChange: setConnected,
    });
    clientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [profile.host, profile.relayPort, sessionId]);

  const sendMessage = useCallback((text: string) => {
    clientRef.current?.sendMessage(text);
  }, []);

  const stopTurn = useCallback(() => {
    clientRef.current?.stopTurn();
  }, []);

  const setCwd = useCallback((path: string) => {
    clientRef.current?.setCwd(path);
  }, []);

  return { connected, cwd, cwdLocked, sendMessage, stopTurn, setCwd };
}
