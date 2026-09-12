import { useSyncExternalStore } from "react";
import { getTitleBarSlot, subscribeTitleBarSlot } from "@/lib/titleBarSlot";

/**
 * The title bar's center node, or `null` when there isn't one — iOS renders
 * no title bar at all, and on desktop the node exists only after the first
 * paint, so a consumer has to re-render when it appears rather than read it
 * once.
 */
export function useTitleBarSlot(): HTMLElement | null {
  return useSyncExternalStore(subscribeTitleBarSlot, getTitleBarSlot, () => null);
}
