import { useEffect, useRef, useState } from "react";
import { isIOS } from "@/lib/platform";

export interface KeyboardInsetInfo {
  /** Offset (px) to apply via `bottom` on the floating composer — 0 when
   * the keyboard is closed, or when the layout itself
   * (`window.innerHeight`) has already shrunk on its own to accommodate
   * the keyboard (in that case the manual offset would be doubled). */
  shift: number;
  /** Whether the keyboard is open or not — calculated **independently** of
   * `shift`, comparing the current `visualViewport` height against the
   * largest height observed so far in this session (the "resting height",
   * no keyboard). Exists separately from `shift > 0` because, if the
   * layout shrinks along with the keyboard (not confirmed whether this
   * happens on the physical device — only validated on the Simulator,
   * where it doesn't shrink), `shift` correctly goes to zero (without this
   * it would double the offset), but that can't mean "keyboard closed" for
   * whoever decides the padding-bottom (`ChatPanel.tsx`): in that scenario
   * it still needs to swap the safe-area-inset-bottom padding (meant for
   * the home indicator, which stops existing with the keyboard open) for a
   * fixed value, otherwise a gap remains even with `shift` correctly zeroed. */
  isOpen: boolean;
  /** Raw values just for temporary visual diagnostics
   * (`KeyboardDebugOverlay.tsx`) — remove together when the overlay goes away. */
  debug: { vvHeight: number; winHeight: number; offsetTop: number; restingVvHeight: number };
}

const EMPTY: KeyboardInsetInfo = {
  shift: 0,
  isOpen: false,
  debug: { vvHeight: 0, winHeight: 0, offsetTop: 0, restingVvHeight: 0 },
};

/**
 * iOS keyboard info calculated via `visualViewport` — see `docs/34` item 1
 * (unwanted gap between composer and keyboard) and `docs/39` (physical
 * device reproduced the bug even after the fix validated only on the
 * Simulator — hypothesis that `visualViewport`/layout behavior differs
 * between the two).
 */
export function useKeyboardInset(): KeyboardInsetInfo {
  const [info, setInfo] = useState<KeyboardInsetInfo>(EMPTY);
  const restingVvHeightRef = useRef(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!isIOS() || !vv) return;

    function update(): void {
      const vvHeight = vv!.height;
      const winHeight = window.innerHeight;
      const offsetTop = vv!.offsetTop;

      if (vvHeight > restingVvHeightRef.current) restingVvHeightRef.current = vvHeight;
      const restingVvHeight = restingVvHeightRef.current;

      const shift = Math.max(0, Math.round(winHeight - vvHeight - offsetTop));
      // 50px margin: react only to a real reduction (keyboard), not small
      // variations (address bar, rotation, etc.).
      const isOpen = restingVvHeight - vvHeight > 50;

      setInfo({ shift, isOpen, debug: { vvHeight, winHeight, offsetTop, restingVvHeight } });
    }

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return info;
}
