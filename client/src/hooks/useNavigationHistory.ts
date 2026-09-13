import { useCallback, useRef, useState } from "react";

export interface NavLocation {
  tabId: string | null;
}

/**
 * Browser-style navigation stack: every active tab change (by user action)
 * pushes an entry, cutting off any "forward" that existed. `goBack`/
 * `goForward` move a pointer through the stack without pushing anything —
 * `notifyLocationChanged` ignores the next call right after one of the two
 * (via `skipNextRef`), because otherwise the tab restoration itself would
 * become a new entry. Since tabs stopped being separated per profile,
 * the location is just the tab — the profile is
 * already embedded in it.
 */
export function useNavigationHistory(): {
  notifyLocationChanged: (location: NavLocation) => void;
  goBack: () => NavLocation | null;
  goForward: () => NavLocation | null;
  canGoBack: boolean;
  canGoForward: boolean;
} {
  const stackRef = useRef<NavLocation[]>([]);
  const pointerRef = useRef(-1);
  const skipNextRef = useRef(false);
  // Only the two booleans below are rendered from any of this — the stack
  // and the pointer live in refs precisely because nothing draws them. A
  // push that leaves both unchanged (every tab switch after the first, which
  // already has somewhere to go back to and nothing to go forward to) has
  // nothing to show for a render, and this hook lives in `App`, so that
  // render is the whole app's.
  const [, forceUpdate] = useState(0);
  const renderedRef = useRef({ canGoBack: false, canGoForward: false });

  /** Recomputes the two booleans from the pointer and re-renders only if one
   * of them actually moved. Reads and writes nothing but refs, so it is
   * stable for the life of the hook. */
  const syncButtons = useCallback(() => {
    const canGoBack = pointerRef.current > 0;
    const canGoForward = pointerRef.current < stackRef.current.length - 1;
    const rendered = renderedRef.current;
    if (canGoBack === rendered.canGoBack && canGoForward === rendered.canGoForward) return;
    renderedRef.current = { canGoBack, canGoForward };
    forceUpdate((n) => n + 1);
  }, []);

  const notifyLocationChanged = useCallback((location: NavLocation) => {
    if (skipNextRef.current) {
      skipNextRef.current = false;
      return;
    }
    const stack = stackRef.current;
    const pointer = pointerRef.current;
    const current = pointer >= 0 ? stack[pointer] : undefined;
    if (current && current.tabId === location.tabId) return;

    const truncated = stack.slice(0, pointer + 1);
    truncated.push(location);
    stackRef.current = truncated;
    pointerRef.current = truncated.length - 1;
    syncButtons();
  }, [syncButtons]);

  const goBack = useCallback((): NavLocation | null => {
    if (pointerRef.current <= 0) return null;
    pointerRef.current -= 1;
    skipNextRef.current = true;
    syncButtons();
    return stackRef.current[pointerRef.current];
  }, [syncButtons]);

  const goForward = useCallback((): NavLocation | null => {
    if (pointerRef.current >= stackRef.current.length - 1) return null;
    pointerRef.current += 1;
    skipNextRef.current = true;
    syncButtons();
    return stackRef.current[pointerRef.current];
  }, [syncButtons]);

  return {
    notifyLocationChanged,
    goBack,
    goForward,
    ...renderedRef.current,
  };
}
