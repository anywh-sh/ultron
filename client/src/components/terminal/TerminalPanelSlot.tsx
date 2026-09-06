import { lazy, Suspense } from "react";
import { usePanelDrag } from "@/hooks/usePanelDrag";
import type { SessionPanelState } from "@/hooks/useSessionPanels";
import type { useTerminalTabs } from "@/hooks/useTerminalTabs";
import type { Profile } from "@/lib/profiles";
import { cn } from "@/lib/utils";

// xterm.js (+ addons) only enters the bundle if/when the user actually opens
// a terminal — the `lazy` lives here, not in the heavy content itself nor in
// App.tsx, because the wrapper below (`TerminalPanelSlot`) needs to exist
// and animate BEFORE the heavy chunk has loaded (the Suspense fallback also
// lives inside the already-animated space).
const TerminalPanel = lazy(() =>
  import("@/components/terminal/TerminalPanel").then((mod) => ({ default: mod.TerminalPanel })),
);

interface TerminalPanelSlotProps {
  profile: Profile;
  chatSessionId: string;
  panel: SessionPanelState;
  terminalTabs: ReturnType<typeof useTerminalTabs>;
  onWidthChange: (width: number) => void;
  onToggleMaximized: () => void;
  onClose: () => void;
}

/**
 * Lightweight wrapper (no xterm.js import) mounted the whole time the chat
 * tab is active — even with the panel closed. This is what gives it the
 * same open/close animation the left sidebar already has
 * (`useResizableSidebar`/App.tsx): there, the wrapper never unmounts, only
 * the width changes (0 collapsed, `width` open) via CSS transition; here it
 * used to be different — the panel's content only existed in the DOM when
 * open, so there was nothing for the transition to animate (it
 * appeared/disappeared instantly). Now the heavy content (`TerminalPanel`,
 * lazy) only mounts when `panel.open`, but the width of whoever hosts it is
 * already animating from before — code splitting stays intact, xterm.js
 * only loads on the first real open.
 */
export function TerminalPanelSlot({
  profile,
  chatSessionId,
  panel,
  terminalTabs,
  onWidthChange,
  onToggleMaximized,
  onClose,
}: TerminalPanelSlotProps) {
  const { isDragging, startDrag } = usePanelDrag(panel.width, onWidthChange);
  const maximizedOpen = panel.open && panel.maximized;

  return (
    <div
      className={cn("h-full shrink-0 overflow-hidden", maximizedOpen && "flex-1")}
      style={{
        width: panel.open ? (panel.maximized ? undefined : panel.width) : 0,
        transition: isDragging ? "none" : "width 150ms ease",
      }}
    >
      {panel.open && (
        <Suspense fallback={<div className="h-full border-l border-border-soft bg-bg-sidebar" style={{ width: panel.maximized ? "100%" : panel.width }} />}>
          <TerminalPanel
            profile={profile}
            chatSessionId={chatSessionId}
            panel={panel}
            terminalTabs={terminalTabs}
            onStartDrag={startDrag}
            onToggleMaximized={onToggleMaximized}
            onClose={onClose}
          />
        </Suspense>
      )}
    </div>
  );
}
