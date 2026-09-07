import { useEffect, useState } from "react";
import { cn, formatDurationLong } from "@/lib/utils";
import { pickThinkingWord } from "@/lib/thinkingWords";
import { isIOS } from "@/lib/platform";

interface TurnIndicatorProps {
  /** Epoch ms of when the turn actually started — comes from the relay
   * (`turn_state`, docs/30), not from when this component mounted. Matters
   * for the device that did NOT send the message (or that connects in the
   * middle of a turn already in progress): without this, the timer would
   * count from when it found out, not the real start, underestimating the
   * time already elapsed. For whoever sent it, `ChatPanel` already fills
   * this in optimistically (`Date.now()` on the send click), so in practice
   * it's always "now" for that tab — the difference only shows up for
   * whoever didn't start it. */
  startedAt: number;
}

/** Indicator for a turn in progress — from the moment of sending until the
 * response finishes (covers network latency + the model's reasoning time,
 * which often doesn't expose real thinking text — see docs/18). Sits above
 * the composer, outside the scrollable log, with no side rail.
 */
export function TurnIndicator({ startedAt }: TurnIndicatorProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(() => Math.floor((Date.now() - startedAt) / 1000));
  const [word] = useState(pickThinkingWord);

  useEffect(() => {
    const tick = () => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return (
    <div className={cn("mt-1 flex items-center gap-1.5 text-xs text-muted-foreground", isIOS() && "mx-3")}>
      <span className="flex items-center gap-0.5">
        <span className="size-1 animate-bounce rounded-full bg-text-faint [animation-delay:-0.3s]" />
        <span className="size-1 animate-bounce rounded-full bg-text-faint [animation-delay:-0.15s]" />
        <span className="size-1 animate-bounce rounded-full bg-text-faint" />
      </span>
      <span className="animate-text-shimmer font-medium">{word}…</span>
      <span className="font-mono">{formatDurationLong(elapsedSeconds)}</span>
    </div>
  );
}
