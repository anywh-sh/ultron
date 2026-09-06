import type { ContextUsage } from "@/lib/relayClient";
import { contextUsageColor, contextUsagePercent } from "@/lib/contextUsage";

interface ContextUsageRingProps {
  usage: ContextUsage | null;
  size?: number;
}

const STROKE_WIDTH = 2.5;

/**
 * Progress ring for the context window, same idea as
 * `PermissionModeButton`. `usage` is `null` until the session's first turn
 * finishes (see useRelayClient/sharedSession.ts) — in that case the
 * component disappears from the toolbar instead of showing a misleading
 * "0%" on a session with no history yet. Color comes from
 * `contextUsageColor` (color-mix over CSS variables, never a fixed hex —
 * see lib/contextUsage.ts).
 */
export function ContextUsageRing({ usage, size = 18 }: ContextUsageRingProps) {
  if (!usage) return null;

  const pct = contextUsagePercent(usage);
  const radius = (size - STROKE_WIDTH) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct / 100);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      className="-rotate-90 shrink-0"
      // Decorative: when used alone the accessible name would come from the
      // `aria-label` below, but the real usage (ContextUsageButton) wraps it
      // in a `<button>` that already declares the label — having both would
      // make a screen reader announce the same information twice.
      aria-hidden="true"
    >
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border)" strokeWidth={STROKE_WIDTH} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={contextUsageColor(pct)}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{ transition: "stroke-dashoffset 0.3s ease, stroke 0.3s ease" }}
      />
    </svg>
  );
}
