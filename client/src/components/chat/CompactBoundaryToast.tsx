import { useEffect, useState } from "react";
import type { CompactBoundaryEvent } from "@/hooks/useRelayClient";

const VISIBLE_MS = 4000;

interface CompactBoundaryToastProps {
  event: CompactBoundaryEvent | null;
}

/**
 * Transient notice when Claude Code compacts the conversation (automatic
 * when approaching the limit, or manual `/compact`) — the context ring
 * already reflects the new total on its own from the next `result` (usage
 * comes out naturally smaller after compaction), this is just so it doesn't
 * go unnoticed. `event.receivedAt` (see useRelayClient) changes on every
 * occurrence, even with the same `trigger`/`preTokens` — the `useEffect`
 * always reopens the timer instead of getting stuck on the first notice.
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
