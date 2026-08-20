import { useCallback, useEffect, useRef, useState } from "react";
import { RelayClient, type ClaudeEvent } from "@/lib/relayClient";
import type { Profile } from "@/lib/profiles";

export interface UseRelayClientOptions {
  onEvent?: (event: ClaudeEvent) => void;
  onTurnComplete?: () => void;
  onTurnError?: (message: string) => void;
  onCaughtUp?: () => void;
}

export interface UseRelayClientResult {
  connected: boolean;
  sendMessage: (text: string) => void;
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
  sessionName: string,
  options: UseRelayClientOptions = {},
): UseRelayClientResult {
  const [connected, setConnected] = useState(false);
  const clientRef = useRef<RelayClient | null>(null);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const client = new RelayClient(profile.host, profile.relayPort, sessionName, {
      onEvent: (event) => optionsRef.current.onEvent?.(event),
      onTurnComplete: () => optionsRef.current.onTurnComplete?.(),
      onTurnError: (message) => optionsRef.current.onTurnError?.(message),
      onCaughtUp: () => optionsRef.current.onCaughtUp?.(),
      onConnectionChange: setConnected,
    });
    clientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [profile.host, profile.relayPort, sessionName]);

  const sendMessage = useCallback((text: string) => {
    clientRef.current?.sendMessage(text);
  }, []);

  return { connected, sendMessage };
}
