import { useEffect, useState } from "react";
import { cn, formatDurationLong } from "@/lib/utils";
import { pickThinkingWord } from "@/lib/thinkingWords";
import { isIOS } from "@/lib/platform";

interface TurnIndicatorProps {
  /** Epoch ms of when the turn actually started — comes from the relay
   * (`turn_state`), not from when this component mounted. Matters
   * for the device that did NOT send the message (or that connects in the
   * middle of a turn already in progress): without this, the timer would
   * count from when it found out, not the real start, underestimating the
   * time already elapsed. For whoever sent it, `ChatPanel` already fills
   * this in optimistically (`Date.now()` on the send click), so in practice
   * it's always "now" for that tab — the difference only shows up for
   * whoever didn't start it.
   *
   * `null` when idle — on desktop this doesn't unmount the component:
   * it goes `invisible` instead, keeping its rendered height
   * permanently reserved so `MessageLog`'s `flex-1` area never resizes when
   * a turn starts or ends. It used to mount/unmount, which shrank that area
   * an instant before the scroll container's `ResizeObserver` caught up,
   * clipping the last bubble under this indicator for a frame. */
  startedAt: number | null;
}

/** Indicator for a turn in progress — from the moment of sending until the
 * response finishes (covers network latency + the model's reasoning time,
 * which often doesn't expose real thinking text). Sits above
 * the composer, outside the scrollable log, with no side rail.
 */
export function TurnIndicator({ startedAt }: TurnIndicatorProps) {
  const active = startedAt !== null;
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [word, setWord] = useState(pickThinkingWord);

  useEffect(() => {
    if (startedAt === null) return;
    setWord(pickThinkingWord());
    const tick = () => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return (
    <div
      className={cn(
        "mt-1 flex items-center gap-1.5 text-xs text-muted-foreground",
        isIOS() && "mx-3",
        !active && "invisible",
      )}
    >
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
