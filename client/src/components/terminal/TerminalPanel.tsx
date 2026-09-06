import { useEffect, useRef } from "react";
import { SessionPanel } from "@/components/shell/SessionPanel";
import { TerminalTabStrip } from "@/components/terminal/TerminalTabStrip";
import { TerminalView } from "@/components/terminal/TerminalView";
import type { SessionPanelState } from "@/hooks/useSessionPanels";
import type { useTerminalTabs } from "@/hooks/useTerminalTabs";
import { closeTerminal } from "@/lib/relayClient";
import type { Profile } from "@/lib/profiles";

interface TerminalPanelProps {
  profile: Profile;
  chatSessionId: string;
  panel: SessionPanelState;
  terminalTabs: ReturnType<typeof useTerminalTabs>;
  /** Drag handler — the width state itself (`isDragging` included) now
   * lives in `TerminalPanelSlot`, not here: it needs to stay visible to the
   * animated wrapper that stays mounted even with the panel closed (see
   * TerminalPanelSlot.tsx). */
  onStartDrag: (event: React.PointerEvent) => void;
  onToggleMaximized: () => void;
  onClose: () => void;
}

/**
 * Terminal-specific content, plugged into the generic `SessionPanel` shell.
 * Only mounts while the chat tab that owns it is active AND the panel is
 * marked open (decided by the caller, see App.tsx) — this conditional
 * mount/unmount is what implements "switching sessions closes the panel on
 * its own, coming back reopens it the way it was": unmounting closes each
 * terminal tab's WS (the relay only detaches from tmux, never kills the
 * session because of it — see terminalSession.ts), remounting reconnects
 * and tmux redraws the screen on its own.
 *
 * All of the panel's terminal tabs stay mounted at the same time
 * (`forceMount`, same trick as `TabBar.tsx`) — only the whole panel
 * connects/disconnects on entering/leaving focus, switching between
 * terminal tabs inside an already-open panel is instant, no reconnecting.
 * The number of tabs per panel tends to be small (a handful), so the cost
 * of keeping them all alive is low — quite different from keeping *every*
 * chat session's terminal alive, which is exactly what the conditional
 * mounting above avoids.
 */
export function TerminalPanel({
  profile,
  chatSessionId,
  panel,
  terminalTabs,
  onStartDrag,
  onToggleMaximized,
  onClose,
}: TerminalPanelProps) {
  const { tabs, activeTerminalId } = terminalTabs.getTabs(chatSessionId);
  const { addTerminal } = terminalTabs;
  /** `true` as soon as the list has had at least one tab — this is what
   * distinguishes "panel just opened, still empty" (seeds "Terminal 1")
   * from "had a tab, user closed the last one" (closes the panel). A single
   * effect, not two: the first version fired both in sequence in the same
   * pass — `addTerminal` already sets a synchronous flag before the new
   * state (`tabs`) has re-rendered, so a separate "close if empty" effect
   * would read `tabs.length` still as 0 and close the panel an instant
   * after opening (found while actually testing: opening always ended up
   * closing itself again). A single effect, driven by the real transition
   * of `tabs.length` between renders, avoids the race. */
  const hasHadTabsRef = useRef(false);
  useEffect(() => {
    if (tabs.length > 0) {
      hasHadTabsRef.current = true;
      return;
    }
    if (hasHadTabsRef.current) {
      onClose();
    } else {
      addTerminal(chatSessionId);
    }
  }, [tabs.length, chatSessionId, onClose, addTerminal]);

  function handleCloseTerminal(terminalId: string): void {
    terminalTabs.closeTerminal(chatSessionId, terminalId);
    closeTerminal(profile.host, profile.relayPort, chatSessionId, terminalId).catch((error: unknown) => {
      console.error("[ultron] failed to close terminal:", error);
    });
  }

  return (
    <SessionPanel
      maximized={panel.maximized}
      onStartDrag={onStartDrag}
      onToggleMaximized={onToggleMaximized}
      onClose={onClose}
      headerExtra={
        <TerminalTabStrip
          tabs={tabs}
          activeTerminalId={activeTerminalId}
          onSelect={(id) => terminalTabs.setActiveTerminal(chatSessionId, id)}
          onClose={handleCloseTerminal}
          onAdd={() => terminalTabs.addTerminal(chatSessionId)}
        />
      }
    >
      <div className="relative h-full min-h-0">
        {tabs.map((tab) => (
          <div key={tab.id} className={tab.id === activeTerminalId ? "absolute inset-0" : "invisible absolute inset-0"}>
            <TerminalView profile={profile} chatSessionId={chatSessionId} terminalId={tab.id} />
          </div>
        ))}
      </div>
    </SessionPanel>
  );
}
