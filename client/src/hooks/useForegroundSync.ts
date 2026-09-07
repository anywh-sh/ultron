import { useEffect } from "react";

/** Slow enough to be invisible on the wire (the control registries are two
 * small JSON reads over the LAN/tailnet), fast enough that a change made on
 * another device shows up while you're still looking at this one. */
const POLL_INTERVAL_MS = 30_000;

/**
 * Re-runs `sync` whenever this device might have fallen behind the host:
 * on mount, on the app coming back to the foreground, on the window
 * regaining focus, and on a slow poll while visible.
 *
 * The three triggers cover different gaps and none of them subsumes the
 * others. `visibilitychange` is the only one iOS reliably gives when the
 * app returns from the background. `focus` is what covers a desktop window
 * that was left visible behind another app — the document never stops being
 * "visible" there, so `visibilitychange` never fires. And neither fires at
 * all when the window just sits in front of you while the change happens on
 * another device, which is what the poll is for.
 *
 * `sync` must be stable (wrap it in `useCallback`) — it's a dependency, and
 * a new identity every render would re-arm the timer on every render.
 */
export function useForegroundSync(sync: () => void): void {
  useEffect(() => {
    sync();

    function syncIfVisible(): void {
      if (document.visibilityState === "visible") sync();
    }

    document.addEventListener("visibilitychange", syncIfVisible);
    window.addEventListener("focus", sync);
    const timer = window.setInterval(syncIfVisible, POLL_INTERVAL_MS);

    return () => {
      document.removeEventListener("visibilitychange", syncIfVisible);
      window.removeEventListener("focus", sync);
      window.clearInterval(timer);
    };
  }, [sync]);
}
