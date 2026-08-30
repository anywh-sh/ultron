import type { KeyboardInsetInfo } from "@/hooks/useKeyboardInset";

/**
 * Overlay temporário só pra diagnosticar o gap do teclado no device físico
 * (docs/39) — o fix foi validado no Simulator mas reproduziu o bug de novo
 * no device real, hipótese de que `visualViewport`/`window.innerHeight` se
 * comportam diferente entre os dois. Remover assim que a causa raiz real
 * for confirmada e o fix definitivo estiver validado.
 */
export function KeyboardDebugOverlay({ info }: { info: KeyboardInsetInfo }) {
  return (
    <div
      className="pointer-events-none fixed inset-x-2 z-50 rounded-md bg-black/80 px-2 py-1 font-mono text-[10px] text-lime-400"
      style={{ top: "calc(env(safe-area-inset-top) + 4px)" }}
    >
      vv:{info.debug.vvHeight} win:{info.debug.winHeight} off:{info.debug.offsetTop} rest:
      {info.debug.restingVvHeight} shift:{info.shift} open:{String(info.isOpen)}
    </div>
  );
}
