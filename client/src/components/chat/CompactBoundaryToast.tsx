import { useEffect, useState } from "react";
import type { CompactBoundaryEvent } from "@/hooks/useRelayClient";

const VISIBLE_MS = 4000;

interface CompactBoundaryToastProps {
  event: CompactBoundaryEvent | null;
}

/**
 * Aviso transitório quando o Claude Code compacta a conversa (automático ao
 * se aproximar do limite, ou `/compact` manual) — o anel de contexto já
 * reflete o novo total sozinho a partir do próximo `result` (usage vem
 * naturalmente menor depois da compactação), isso aqui é só pra não passar
 * batido. `event.receivedAt` (ver useRelayClient) muda a cada ocorrência,
 * mesmo `trigger`/`preTokens` repetidos — o `useEffect` sempre reabre o
 * timer em vez de ficar preso no primeiro aviso.
 */
export function CompactBoundaryToast({ event }: CompactBoundaryToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!event) return;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [event]);

  if (!event || !visible) return null;

  return (
    <span className="text-xs text-muted-foreground">
      {event.trigger === "auto" ? "Conversa compactada automaticamente" : "Conversa compactada"}
    </span>
  );
}
