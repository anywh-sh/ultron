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
 * become a new entry (docs/21). Since docs/29 (general tabs, no
 * per-profile separation) the location is just the tab — the profile is
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
  const [, forceUpdate] = useState(0);

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
    forceUpdate((n) => n + 1);
  }, []);

  const goBack = useCallback((): NavLocation | null => {
    if (pointerRef.current <= 0) return null;
    pointerRef.current -= 1;
    skipNextRef.current = true;
    forceUpdate((n) => n + 1);
    return stackRef.current[pointerRef.current];
  }, []);

  const goForward = useCallback((): NavLocation | null => {
    if (pointerRef.current >= stackRef.current.length - 1) return null;
    pointerRef.current += 1;
    skipNextRef.current = true;
    forceUpdate((n) => n + 1);
    return stackRef.current[pointerRef.current];
  }, []);

  return {
    notifyLocationChanged,
    goBack,
    goForward,
    canGoBack: pointerRef.current > 0,
    canGoForward: pointerRef.current < stackRef.current.length - 1,
  };
}
