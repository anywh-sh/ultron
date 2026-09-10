import { useEffect, useMemo, useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/shell/Sidebar";
import { EmptyState } from "@/components/shell/EmptyState";
import { SessionSearch } from "@/components/shell/SessionSearch";
import { SettingsDialog } from "@/components/shell/SettingsDialog";
import { TabBar } from "@/components/shell/TabBar";
import { TitleBar } from "@/components/shell/TitleBar";
import { MobileShell } from "@/components/shell/MobileShell";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { SessionDock } from "@/components/shell/SessionDock";
import { FilesPanelSlot } from "@/components/files/FilesPanelSlot";
import { TerminalPanelSlot } from "@/components/terminal/TerminalPanelSlot";
import { useActiveProfile } from "@/hooks/useActiveProfile";
import { useNavigationHistory } from "@/hooks/useNavigationHistory";
import { useSessionNames } from "@/hooks/useSessionNames";
import { useResizableSidebar } from "@/hooks/useResizableSidebar";
import { useIsCompactViewport } from "@/hooks/useIsCompactViewport";
import { useTabs, type Tab } from "@/hooks/useTabs";
import { useSessionDock } from "@/hooks/useSessionDock";
import { useTerminalTabs } from "@/hooks/useTerminalTabs";
import { useFileTabs } from "@/hooks/useFileTabs";
import { useWindowFocus } from "@/hooks/useWindowFocus";
import { useNotificationClick } from "@/hooks/useNotificationClick";
import { useProfileImport } from "@/hooks/useProfileImport";
import { useActiveTheme, useThemeSync } from "@/hooks/useThemes";
import { useProfileSync } from "@/hooks/useProfileSync";
import { useTailnetSidecarOwner } from "@/hooks/useTailnetSidecarOwner";
import { findProfile, getProfiles, type Profile } from "@/lib/profiles";
import { resolveChatPath } from "@/lib/filesClient";
import { resolveConnection } from "@/lib/connectionResolver";
import { ensureNotificationPermission, notifyTurnComplete } from "@/lib/notifications";
import { deleteSession, renameSession } from "@/lib/relayClient";
import { isIOS } from "@/lib/platform";
import { cn } from "@/lib/utils";

/** Optional override via query string (`?profile=&session=`) — only to allow
 * a direct deep-link to a specific state in tests via Playwright (docs/13). */
function readQueryOverride(): { profile: string | null; session: string | null } {
  const params = new URLSearchParams(window.location.search);
  return { profile: params.get("profile"), session: params.get("session") };
}

export default function App() {
  const queryOverride = useMemo(readQueryOverride, []);
  const [activeProfile, setActiveProfileId] = useActiveProfile(queryOverride.profile);
  const { sessions, loading: sessionsLoading, upsertTitle, removeSession, touch } = useSessionNames(activeProfile);
  const isCompact = useIsCompactViewport();
  const resizable = useResizableSidebar();
  const tabsState = useTabs();
  const sessionDock = useSessionDock();
  const terminalTabs = useTerminalTabs();
  const fileTabs = useFileTabs();
  const nav = useNavigationHistory();
  const windowFocused = useWindowFocus();
  // Both registry mirrors live here, at the one place that is mounted for
  // the whole life of the app in both layouts. The profile sync used to sit
  // inside ProfileSwitcher, which the collapsible sidebar unmounts and iOS
  // never renders at all — so collapsing the sidebar turned it off and the
  // phone never ran it.
  const { supported: profilesSupported } = useProfileSync(activeProfile);
  // Holds the active profile's tailnet-sidecar reference for as long as it's
  // selected — the sidebar/sync hooks above run against it before any chat
  // tab (the only other thing that used to acquire one) ever mounts for it
  // (journal/62, "todo tráfego que não é o WebSocket do chat").
  useTailnetSidecarOwner(activeProfile);

  // The painted theme tracks its own profile, separate from `activeProfile`:
  // `activeProfile` also moves when a tab is opened for a session that
  // belongs to another profile (search, notification click) — that's meant
  // to update the sidebar/session list, not repaint the whole app out from
  // under whatever the user is reading. Only an explicit pick in the
  // bottom-left ProfileSwitcher (`handleProfileChange`) should change the
  // theme.
  const [themeProfileId, setThemeProfileId] = useState(activeProfile.id);
  const themeProfile = findProfile(themeProfileId) ?? activeProfile;
  useThemeSync(themeProfile);
  useActiveTheme(themeProfile);
  // Usually the same profile as `activeProfile` above (and then a no-op
  // extra reference on the same sidecar entry) — only diverges briefly when
  // a tab from another profile gets focus (search/notification click) while
  // the sidebar's own selection hasn't moved yet.
  useTailnetSidecarOwner(themeProfile);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Connection state per tab — used by TitleBar/MobileTopBar (docs/24), which
  // live outside ChatPanel. Fed by `renderPanel`'s `onConnectedChange` below.
  // Keyed by tab id (not a single flag) because desktop's TabBar keeps every
  // tab's ChatPanel mounted at once (forceMount, see the `key={tab.id}`
  // comment in `renderPanel`): a background tab's `connected` can flip while
  // it's not the active one, and nothing re-fires once it becomes active
  // again. A single flag reset to `false` on every tab switch (the previous
  // approach) got stuck showing "Reconectando…" forever for a tab that was
  // already connected, since its `connected` value wasn't changing anymore
  // to trigger another update.
  const [connectedByTab, setConnectedByTab] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void ensureNotificationPermission();
  }, []);

  // Global search shortcut (Ctrl/Cmd+K — docs/21), on any screen.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // First launch: restores last time's tabs (full list + order + which one
  // was active), across all profiles together (docs/29). Only runs once,
  // while no tab is open yet. The test deep-link via query string (docs/13)
  // takes priority and still opens only the requested session, in the given
  // profile (or the default one).
  useEffect(() => {
    if (tabsState.tabs.length > 0) return;
    if (queryOverride.session) {
      tabsState.openTab(activeProfile.id, queryOverride.session);
      return;
    }
    const persisted = tabsState.getPersistedTabs();
    if (persisted) tabsState.restoreTabs(persisted.tabs, persisted.activeTabId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeTabId = tabsState.activeTabId;
  const activeConnected = activeTabId ? (connectedByTab[activeTabId] ?? false) : false;

  // Clears the "turn complete" badge of the tab that's visible now.
  useEffect(() => {
    if (activeTabId) tabsState.setUnread(activeTabId, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId]);

  // Drops `connectedByTab` entries for tabs that no longer exist (closed via
  // any of the several paths that call `closeTab`), so the map doesn't grow
  // unbounded across a long session.
  useEffect(() => {
    const openIds = new Set(tabsState.tabs.map((tab) => tab.id));
    setConnectedByTab((prev) => {
      const next = Object.fromEntries(Object.entries(prev).filter(([id]) => openIds.has(id)));
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [tabsState.tabs]);

  // Pushes a history entry (titlebar Back/Forward — docs/21) every time the
  // active tab changes, except when the change came from goBack/goForward
  // itself (the hook filters that out internally).
  useEffect(() => {
    nav.notifyLocationChanged({ tabId: activeTabId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId]);

  function handleGoBack(): void {
    const location = nav.goBack();
    if (location?.tabId) tabsState.setActiveTab(location.tabId);
  }

  function handleGoForward(): void {
    const location = nav.goForward();
    if (location?.tabId) tabsState.setActiveTab(location.tabId);
  }

  function handleProfileChange(profileId: string): void {
    setActiveProfileId(profileId);
    setThemeProfileId(profileId);
    setDrawerOpen(false);
  }

  // Creates the session implicitly: opens a blank tab right away, without
  // asking for a name — the title is inferred from the first prompt the user
  // sends (the relay fires this in parallel with the turn, see
  // sessionManager.ts). The session only enters the sidebar once that title
  // arrives (ChatPanel's onTitle below), not before.
  function handleNewConversation(): void {
    const id = crypto.randomUUID();
    tabsState.openTab(activeProfile.id, id, null, true);
    setDrawerOpen(false);
  }

  function handleSelectSession(id: string): void {
    const title = sessions.find((session) => session.id === id)?.title ?? null;
    tabsState.openTab(activeProfile.id, id, title);
    setDrawerOpen(false);
  }

  /** Switches profile (sidebar) + opens/activates the tab — used both by
   * session search (Cmd/Ctrl+K) and by clicking a notification
   * (`useNotificationClick` below), the two cases of "jump straight to a
   * session that may not belong to the currently selected profile". */
  function focusSession(profileId: string, sessionId: string, title: string | null = null): void {
    setActiveProfileId(profileId);
    tabsState.openTab(profileId, sessionId, title);
  }

  function handleSearchSelectSession(profileId: string, sessionId: string, title: string): void {
    focusSession(profileId, sessionId, title);
  }

  // Click on a turn-complete notification — see useNotificationClick.ts for
  // how each platform delivers this (and the limitation documented there:
  // Windows and iOS work, macOS/Linux desktop has no click hook).
  useNotificationClick(({ sessionId, profileId }) => {
    focusSession(profileId, sessionId);
  });

  // Deep-link profile import (`ultron://import-profile`) — see
  // useProfileImport.ts. Switches straight to the newly added profile,
  // same as picking one in the switcher.
  useProfileImport((profileId) => {
    setActiveProfileId(profileId);
  });

  /** Explicit `profileId` (not always `activeProfile`) for the same reason as
   * `handleDeleteSession` right below: it's also called from a tab belonging
   * to a profile other than the one currently selected in the sidebar
   * (docs/29). */
  function handleRenameSession(profileId: string, id: string, title: string): void {
    const profile = findProfile(profileId);
    if (!profile) return;
    resolveConnection(profile)
      .then(({ host, port, token }) => renameSession(host, port, id, title, token))
      .then(() => {
        tabsState.setTabTitle(id, title);
        if (profileId === activeProfile.id) upsertTitle(id, title);
      })
      .catch((error: unknown) => {
        console.error("[ultron] failed to rename session", error);
        window.alert("Não foi possível renomear a sessão.");
      });
  }

  /** Only removes the session from ultron's control — doesn't delete the
   * transcript that Claude Code already keeps on its own. Explicit
   * `profileId` (not always `activeProfile`) because it's also called from a
   * tab belonging to a profile other than the one currently selected in the
   * sidebar (docs/29). */
  function handleDeleteSession(profileId: string, id: string): void {
    const profile = findProfile(profileId);
    if (!profile) return;
    resolveConnection(profile)
      .then(({ host, port, token }) => deleteSession(host, port, id, token))
      .then(() => {
        tabsState.closeTab(id);
        sessionDock.removeSession(id);
        terminalTabs.removeSession(id);
        fileTabs.removeSession(id);
        if (profileId === activeProfile.id) removeSession(id);
      })
      .catch((error: unknown) => {
        console.error("[ultron] failed to delete session", error);
        window.alert("Não foi possível excluir a sessão.");
      });
  }

  function handleCloseActiveTab(): void {
    if (!activeTabId) return;
    tabsState.closeTab(activeTabId);
  }

  function handleToggleSidebarShortcut(): void {
    if (isCompact) {
      setDrawerOpen((open) => !open);
    } else {
      resizable.toggleCollapsed();
    }
  }

  // Embedded terminal (docs/30) — desktop only (the original screenshot/flow
  // is clearly desktop, iOS is left out for now, same gate that voice/titlebar
  // already use — docs/23).
  function handleToggleTerminalPanel(): void {
    if (isCompact || isIOS() || !activeTabId) return;
    sessionDock.togglePane(activeTabId, "terminal");
  }

  // Work dir file panel (docs/41) — same desktop-only gate as the terminal.
  function handleToggleFilesPanel(): void {
    if (isCompact || isIOS() || !activeTabId) return;
    sessionDock.togglePane(activeTabId, "files");
  }

  /** "Open in terminal" on a folder row in the file tree — always a fresh
   * tab (never reuses/clobbers one the user might already be typing in),
   * rooted at that folder. `openPane` (not `togglePane`) because this only
   * ever means "show me this", never "close it" — same desktop-only gate as
   * the terminal panel itself. */
  function handleOpenTerminalAt(tabId: string, path: string): void {
    if (isCompact || isIOS()) return;
    sessionDock.openPane(tabId, "terminal");
    terminalTabs.addTerminal(tabId, path);
  }

  /** A path mentioned in assistant chat text (`Message.tsx`'s `AssistantText`)
   * — same "always show it" gate/`openPane` as `handleOpenTerminalAt` above.
   * Resolution (bare-filename search, ancestor walk for a wrong last
   * segment) runs server-side (`relay/src/fsFiles.ts::resolveChatPath`) —
   * `existingDirs` gets expanded in the tree regardless of whether `target`
   * panned out, so a path that's slightly off still lands the user
   * somewhere browsable instead of just failing silently. */
  function handleOpenFilePath(profile: Profile, tabId: string, rawPath: string): void {
    if (isCompact || isIOS()) return;
    sessionDock.openPane(tabId, "files");
    resolveChatPath(profile, tabId, rawPath)
      .then(({ target, isDirectory, existingDirs }) => {
        if (existingDirs.length > 0) fileTabs.expandDirs(tabId, existingDirs);
        if (target && !isDirectory) fileTabs.openPreview(tabId, target);
      })
      .catch(() => {});
  }

  // Ctrl+Tab / Ctrl+Shift+Tab, like a browser — intentionally only `ctrlKey`,
  // not `metaKey || ctrlKey` like the other shortcuts below: on macOS Cmd+Tab
  // is the OS's own app switcher (never reaches the app), so the real
  // convention for cycling tabs there is also literal Ctrl+Tab, same as
  // browser/VS Code — using `metaKey` here would just create a dead shortcut.
  function handleCycleTab(direction: 1 | -1): void {
    const { tabs } = tabsState;
    if (tabs.length < 2) return;
    const currentIndex = tabs.findIndex((tab) => tab.id === tabsState.activeTabId);
    const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
    tabsState.setActiveTab(tabs[nextIndex].id);
  }

  // Standard shortcuts for any app (Ctrl on Windows/Linux and Cmd on macOS,
  // via metaKey || ctrlKey): new (N), close current tab (W), show/hide side
  // panel (B). Terminal (Ctrl+`) is handled separately, see the comment
  // inside the handler.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.ctrlKey && event.key === "Tab") {
        event.preventDefault();
        handleCycleTab(event.shiftKey ? -1 : 1);
        return;
      }
      // `Ctrl+\`` — literal Ctrl even on macOS, never `metaKey`: it's VS
      // Code's own convention (Cmd+` on macOS is already an OS shortcut for
      // switching between windows of the same app), same reason as
      // `Ctrl+Tab` above. Intentionally left out of the switch below, which
      // is only `metaKey || ctrlKey`.
      if (event.ctrlKey && event.key === "`") {
        event.preventDefault();
        handleToggleTerminalPanel();
        return;
      }
      // `Ctrl+Shift+E` — VS Code's own Explorer shortcut, literal Ctrl even
      // on macOS, same reasoning as `Ctrl+\`` right above.
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "e") {
        event.preventDefault();
        handleToggleFilesPanel();
        return;
      }
      if (!(event.metaKey || event.ctrlKey)) return;
      switch (event.key.toLowerCase()) {
        case "n":
          event.preventDefault();
          handleNewConversation();
          break;
        case "w":
          event.preventDefault();
          handleCloseActiveTab();
          break;
        case "b":
          event.preventDefault();
          handleToggleSidebarShortcut();
          break;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeProfile.id,
    sessionDock.togglePane,
    activeTabId,
    isCompact,
    tabsState.closeTab,
    tabsState.openTab,
    tabsState.setActiveTab,
    resizable.toggleCollapsed,
  ]);

  // "Running" sessions only for the profile currently selected in the
  // sidebar — that's the universe the sidebar list shows (docs/29: tabs
  // themselves no longer have a notion of selected profile, only the sidebar
  // does).
  const runningSessions = new Set(
    tabsState.tabs.filter((tab) => tab.profileId === activeProfile.id && tab.isRunning).map((tab) => tab.id),
  );
  // Same reasoning as `runningSessions` — only covers sessions open as a tab
  // (docs/32, Phase E): a session without a tab has no live WS connection to
  // know whether it has a job running, same limitation `isRunning` already
  // had.
  const backgroundJobSessions = new Set(
    tabsState.tabs.filter((tab) => tab.profileId === activeProfile.id && tab.hasBackgroundJob).map((tab) => tab.id),
  );

  const sidebarProps = {
    activeProfile,
    profilesSupported,
    onProfileChange: handleProfileChange,
    sessions,
    sessionsLoading,
    selectedSession: activeTabId,
    runningSessions,
    backgroundJobSessions,
    onSelectSession: handleSelectSession,
    onNewConversation: handleNewConversation,
    onRenameSession: (id: string, title: string) => handleRenameSession(activeProfile.id, id, title),
    onDeleteSession: (id: string) => handleDeleteSession(activeProfile.id, id),
  };

  const activeTab = tabsState.tabs.find((tab) => tab.id === activeTabId);

  // A tab can belong to any profile (docs/29) — each one's `ChatPanel` uses
  // the profile recorded on the tab itself, not the profile currently
  // selected in the sidebar.
  const renderPanel = (tab: Tab) => {
    const profile = findProfile(tab.profileId) ?? getProfiles()[0];
    const dock = sessionDock.getDock(tab.id);
    const isTabActive = tab.id === activeTabId;
    const chatContent = (
      <ChatPanel
        // On iOS (no TabBar/forceMount), `activeTab && renderPanel(activeTab)`
        // is a single JSX slot whose `sessionId` just changes value — without
        // a `key` tied to the session, React reuses the same instance when
        // switching conversations (only updates props), and internal state
        // (useMessageLog etc.) doesn't reset on its own. `onReconnecting`
        // doesn't help here: it only fires on a real reconnection of the SAME
        // RelayClient instance, not when useRelayClient swaps sessionId and
        // creates a new instance. The result was a real bug: clicking "+"
        // would open a genuinely new session (connecting,
        // "Reconnecting"→"Connected") but the screen kept showing the
        // previous conversation's log. On desktop this didn't happen (TabBar
        // already has `key={tab.id}` on TabsContent, each tab with its own
        // instance) — here it's just made explicit in the same spot.
        key={tab.id}
        profile={profile}
        sessionId={tab.id}
        isNewConversation={tab.isNew}
        onTurnActiveChange={(active) => tabsState.setRunning(tab.id, active)}
        onBackgroundJobsChange={(jobs) => tabsState.setHasBackgroundJob(tab.id, jobs.length > 0)}
        onTurnComplete={({ stopped, lastUserText, lastAssistantText }) => {
          const stillVisible = tab.id === tabsState.activeTabId && windowFocused;
          if (stillVisible) return;
          tabsState.setUnread(tab.id, true);
          notifyTurnComplete(tab.id, profile, tab.title ?? "Nova sessão", lastUserText, lastAssistantText, stopped);
        }}
        onTitle={(title) => {
          tabsState.setTabTitle(tab.id, title);
          if (tab.profileId === activeProfile.id) upsertTitle(tab.id, title);
        }}
        onActivity={() => {
          if (tab.profileId === activeProfile.id) touch(tab.id);
        }}
        onDeleted={() => {
          tabsState.closeTab(tab.id);
          sessionDock.removeSession(tab.id);
          terminalTabs.removeSession(tab.id);
          fileTabs.removeSession(tab.id);
          if (tab.profileId === activeProfile.id) removeSession(tab.id);
        }}
        onConnectedChange={(connected) => {
          setConnectedByTab((prev) => (prev[tab.id] === connected ? prev : { ...prev, [tab.id]: connected }));
        }}
        terminal={
          isCompact || isIOS()
            ? undefined
            : { open: dock.panes.includes("terminal"), onToggle: () => sessionDock.togglePane(tab.id, "terminal") }
        }
        files={
          isCompact || isIOS()
            ? undefined
            : { open: dock.panes.includes("files"), onToggle: () => sessionDock.togglePane(tab.id, "files") }
        }
        onOpenPath={isCompact || isIOS() ? undefined : (path) => handleOpenFilePath(profile, tab.id, path)}
        isActiveTab={isTabActive}
      />
    );

    if (isCompact || isIOS()) return chatContent;

    // Embedded terminal (docs/30) and files pane (docs/41), desktop only.
    // `isTabActive` is what implements "switching sessions closes the dock on
    // its own, coming back reopens it the way it was": `TabBar` keeps ALL
    // tabs mounted in the background (forceMount, to keep the chat WS alive
    // — see comment further below), so without this gate the dock's panes
    // would stay connected for out-of-focus sessions too. Only the active
    // tab actually mounts `SessionDock`; the others don't even exist in the
    // DOM, so they don't open any terminal/watch WS either — the cost of
    // several chat tabs open at once (multiple profiles, multiple contexts)
    // stays limited to a single live dock at a time, not one per session.
    //
    // The gate here doesn't include `dock.panes.length === 0` — that's how
    // the open/close animation (same as the left sidebar's,
    // useResizableSidebar) works: `SessionDock` stays mounted the whole time
    // the tab is active, and IT (internally, lightweight) is what decides the
    // width (0 closed, animating to `dock.width` when open). Without this the
    // dock's content only existed in the DOM while open — there was nothing
    // for the CSS transition to animate, it just popped in/out.
    const chatHidden = isTabActive && dock.maximized !== null;

    // The wrapper (this `div` + the `div` right below wrapping
    // `chatContent`) is rendered unconditionally, with the SAME shape
    // always — only the presence of `SessionDock` as a sibling toggles (along
    // with the tab becoming active/inactive). Before this it was conditional
    // (`if (!showTerminal) return chatContent` with no wrapper at all), and
    // opening/closing/switching the terminal tab changed the type of the
    // child at that position in the tree (from `ChatPanel` directly to
    // `div`) — React saw that as a different element and unmounted the whole
    // `ChatPanel` (losing `ready`, closing the WS, reconnecting), which is
    // exactly the skeleton flash reported when opening/expanding/closing the
    // panel. Keeping the shape stable avoids that remount.
    return (
      <div className="relative flex h-full min-w-0">
        {/* `invisible absolute inset-0` instead of shrinking to 0 — same
         * trick (and same reason) as `TabBar.tsx`'s `forceMount`: `MessageLog`
         * uses `@tanstack/react-virtual`, whose `ResizeObserver` corrupts the
         * height cache if the container measures size 0 even briefly (which
         * is exactly what would happen when maximizing a pane if the chat
         * were hidden via `display:none`/zero width). */}
        <div className={cn("min-w-0 flex-1", chatHidden && "invisible absolute inset-0")}>{chatContent}</div>
        {isTabActive && (
          <SessionDock
            dock={dock}
            onWidthChange={(width) => sessionDock.setWidth(tab.id, width)}
            onSplitRatioChange={(ratio) => sessionDock.setSplitRatio(tab.id, ratio)}
            panes={{
              terminal: dock.panes.includes("terminal") ? (
                <TerminalPanelSlot
                  profile={profile}
                  chatSessionId={tab.id}
                  maximized={dock.maximized === "terminal"}
                  terminalTabs={terminalTabs}
                  onToggleMaximized={() => sessionDock.toggleMaximized(tab.id, "terminal")}
                  onClose={() => sessionDock.closePane(tab.id, "terminal")}
                />
              ) : undefined,
              files: dock.panes.includes("files") ? (
                <FilesPanelSlot
                  profile={profile}
                  chatSessionId={tab.id}
                  maximized={dock.maximized === "files"}
                  fileTabs={fileTabs}
                  onToggleMaximized={() => sessionDock.toggleMaximized(tab.id, "files")}
                  onClose={() => sessionDock.closePane(tab.id, "files")}
                  onOpenTerminal={(path) => handleOpenTerminalAt(tab.id, path)}
                />
              ) : undefined,
            }}
          />
        )}
      </div>
    );
  };

  // Shared between the desktop shell and iOS — what changes between the two
  // is just the surrounding chrome (TitleBar+Sidebar vs. MobileShell), not
  // how each session gets mounted.
  //
  // `relative` down here isn't about layout — without it, iOS's
  // MobileTopBar/composer `backdrop-filter` doesn't sample the message log
  // on real WebKit (real bug, reproduced via Playwright WebKit — docs/24).
  // Any `position: static` div in this chain up to `.mobile-canvas` breaks
  // the blur. Don't remove it even though it looks redundant — harmless for
  // desktop (doesn't change position/size of anything).
  const tabsContent = (
    <div className="relative min-h-0 flex-1">
      {tabsState.tabs.length === 0 ? (
        <EmptyState />
      ) : isIOS() ? (
        // iOS (docs/23, Phase B): the MVP is one session in focus at a time,
        // without keeping several WebSocket connections alive in parallel in
        // the background — only mounts the active session, without TabBar's
        // tab mechanism (forceMount/dnd-kit, designed for desktop).
        activeTab && renderPanel(activeTab)
      ) : (
        <TabBar
          tabs={tabsState.tabs}
          activeTabId={activeTabId}
          onSelect={tabsState.setActiveTab}
          onClose={tabsState.closeTab}
          onReorder={tabsState.reorderTabs}
          onRenameSession={(tabId, title) => {
            const tab = tabsState.tabs.find((t) => t.id === tabId);
            if (tab) handleRenameSession(tab.profileId, tabId, title);
          }}
          onDelete={(tabId) => {
            const tab = tabsState.tabs.find((t) => t.id === tabId);
            if (tab) handleDeleteSession(tab.profileId, tabId);
          }}
          renderPanel={renderPanel}
        />
      )}
    </div>
  );

  if (isIOS()) {
    return (
      // `h-full`, not `h-screen`/`h-dvh` — both are independent viewport-height
      // calculations that can disagree with the `body { position: fixed; inset: 0 }`
      // hack in index.css (already pinned to the real visible viewport). `h-full`
      // instead inherits that exact box via `#app { height: 100% }` (found live
      // testing `ChoiceCard` clipping/leaving a gap under the composer on iOS,
      // journal/46 follow-up).
      <div className="flex h-full w-screen flex-col overflow-hidden bg-background text-foreground">
        <SessionSearch open={searchOpen} onOpenChange={setSearchOpen} onSelectSession={handleSearchSelectSession} />
        <MobileShell
          activeProfile={activeProfile}
          onProfileChange={handleProfileChange}
          sessions={sessions}
          sessionsLoading={sessionsLoading}
          selectedSession={activeTabId}
          runningSessions={runningSessions}
          backgroundJobSessions={backgroundJobSessions}
          onSelectSession={handleSelectSession}
          onRenameSession={(id, title) => handleRenameSession(activeProfile.id, id, title)}
          onDeleteSession={(id) => handleDeleteSession(activeProfile.id, id)}
          onOpenSearch={() => setSearchOpen(true)}
          title={activeTab?.title ?? "Nova sessão"}
          connected={activeConnected}
          onNewConversation={handleNewConversation}
        >
          {tabsContent}
        </MobileShell>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <TitleBar
        canGoBack={nav.canGoBack}
        canGoForward={nav.canGoForward}
        onGoBack={handleGoBack}
        onGoForward={handleGoForward}
        showSidebarToggle={!isCompact}
        sidebarCollapsed={resizable.collapsed}
        onToggleSidebar={resizable.toggleCollapsed}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        connected={activeConnected}
      />

      <SessionSearch open={searchOpen} onOpenChange={setSearchOpen} onSelectSession={handleSearchSelectSession} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} activeProfile={activeProfile} />

      <div className="flex min-h-0 flex-1">
        {!isCompact && (
          <div
            className="relative flex shrink-0 border-r border-border-soft"
            style={{
              width: resizable.width,
              transition: resizable.isDragging ? "none" : "width 150ms ease",
            }}
          >
            <div className="min-w-0 flex-1 overflow-hidden">
              {!resizable.collapsed && <Sidebar {...sidebarProps} />}
            </div>
            {!resizable.collapsed && (
              <div
                onPointerDown={resizable.startDrag}
                className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-border"
              />
            )}
          </div>
        )}

        {isCompact && (
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetContent side="left" className="w-[280px] gap-0 border-r border-border-soft bg-bg-sidebar p-0 sm:max-w-[280px]">
              <SheetTitle className="sr-only">Barra lateral</SheetTitle>
              <Sidebar {...sidebarProps} />
            </SheetContent>
          </Sheet>
        )}

        <div className="relative flex min-w-0 flex-1 flex-col">
          {isCompact && (
            <div className="flex items-center gap-2 p-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={() => setDrawerOpen(true)} aria-label="Abrir barra lateral">
                    <Menu className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Abrir barra lateral</TooltipContent>
              </Tooltip>
            </div>
          )}

          {tabsContent}
        </div>
      </div>
    </div>
  );
}
