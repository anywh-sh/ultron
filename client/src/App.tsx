import { useCallback, useEffect, useMemo, useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/shell/Sidebar";
import { EmptyState } from "@/components/shell/EmptyState";
import { SessionSearch } from "@/components/shell/SessionSearch";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { TabGroupLayout } from "@/components/shell/TabGroupLayout";
import { TitleBar } from "@/components/shell/TitleBar";
import { MobileShell } from "@/components/shell/MobileShell";
import { RevokedProfileBanners } from "@/components/shell/RevokedProfileBanner";
import { ProfileSetupDialog } from "@/components/shell/ProfileSetupDialog";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { SessionDock } from "@/components/shell/SessionDock";
import { DownloadToasts } from "@/components/files/DownloadToasts";
import { FilesPanelSlot } from "@/components/files/FilesPanelSlot";
import { TerminalPanelSlot } from "@/components/terminal/TerminalPanelSlot";
import { useDict } from "@/i18n";
import { useActiveProfile } from "@/hooks/useActiveProfile";
import { useNavigationHistory } from "@/hooks/useNavigationHistory";
import { useSessionNames } from "@/hooks/useSessionNames";
import { useSessionListBootstrap } from "@/hooks/useSessionListBootstrap";
import { useMergedSessions } from "@/hooks/useMergedSessions";
import { useProfiles } from "@/hooks/useProfiles";
import { useResizableSidebar } from "@/hooks/useResizableSidebar";
import { useIsCompactViewport } from "@/hooks/useIsCompactViewport";
import { useTabs, type Tab } from "@/hooks/useTabs";
import { useSessionDock } from "@/hooks/useSessionDock";
import { useTerminalTabs } from "@/hooks/useTerminalTabs";
import { useFileTabs } from "@/hooks/useFileTabs";
import { useWindowFocus } from "@/hooks/useWindowFocus";
import { useNotificationClick } from "@/hooks/useNotificationClick";
import { useProfileImport } from "@/hooks/useProfileImport";
import { useProfileSetup } from "@/hooks/useProfileSetup";
import { useActiveTheme, useThemeSync } from "@/hooks/useThemes";
import { useProfileSync } from "@/hooks/useProfileSync";
import { useTailnetSidecarOwner } from "@/hooks/useTailnetSidecarOwner";
import { addProfile, findProfile, getProfiles, removeProfile, type Profile } from "@/lib/profiles";
import { clearProfileRevoked, isProfileRevoked } from "@/lib/profileRevocation";
import {
  pruneCachedProfiles,
  removeCachedSession,
  touchCachedSession,
  upsertCachedSession,
} from "@/lib/sessionListCache";
import type { MergedSession } from "@/lib/sessionGrouping";
import { completeProfileSetup, dismissProfileSetup, retryProfileSetup } from "@/lib/profileSetup";
import { resolveChatPath } from "@/lib/filesClient";
import { resolveConnection } from "@/lib/connectionResolver";
import { ensureNotificationPermission, notifyTurnComplete } from "@/lib/notifications";
import { deleteSession, renameSession } from "@/lib/relayClient";
import { isIOS } from "@/lib/platform";
import { cn } from "@/lib/utils";

/** Optional override via query string (`?profile=&session=`) — only to allow
 * a direct deep-link to a specific state in tests via Playwright. */
function readQueryOverride(): { profile: string | null; session: string | null } {
  const params = new URLSearchParams(window.location.search);
  return { profile: params.get("profile"), session: params.get("session") };
}

export default function App() {
  const dict = useDict();
  const queryOverride = useMemo(readQueryOverride, []);
  const [activeProfile, setActiveProfileId] = useActiveProfile(queryOverride.profile);
  const { loading: sessionsLoading, error: sessionsError, reload: reloadSessions } = useSessionNames(activeProfile);
  const profiles = useProfiles();
  // One fetch per profile this device has never synced, ever — every other
  // profile's rows come from the cache and are refreshed by whatever
  // connection the app was already making.
  useSessionListBootstrap(activeProfile.id);
  // Which profiles the sidebar shows, deliberately not `activeProfile`:
  // that one means "where work happens" (connection, theme, where a new
  // conversation lands) and already moves on its own when a tab from another
  // profile takes focus. Overloading it with "what am I looking at" would
  // make switching tabs silently change the filter.
  const [selectedProfileIds, setSelectedProfileIds] = useState<ReadonlySet<string>>(
    () => new Set(getProfiles().map((profile) => profile.id)),
  );
  const sessions = useMergedSessions(selectedProfileIds);
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
  // tab (the only other thing that used to acquire one) ever mounts for it.
  useTailnetSidecarOwner(activeProfile);

  // The theme is one device-wide choice, so nothing here is scoped to a
  // profile: the catalog the settings dialog offers comes from whichever
  // host this device is connected to, and what gets painted is what the
  // person picked, whatever profile they're reading right now.
  useThemeSync(activeProfile);
  useActiveTheme();

  // A profile added (pairing, setup) joins the view; one removed leaves it,
  // along with its cached rows. Reconciled here rather than at each
  // `removeProfile` call site — there are already several, and a persisted
  // cache that stays correct only while every future one remembers to clean
  // up is a bug waiting to be written.
  useEffect(() => {
    const known = new Set(profiles.map((profile) => profile.id));
    pruneCachedProfiles(known);
    setSelectedProfileIds((previous) => {
      const next = new Set([...previous].filter((id) => known.has(id)));
      for (const id of known) if (!previous.has(id)) next.add(id);
      // Every profile deselected would leave an empty sidebar with no way
      // back except the filter menu — fall back to showing everything.
      if (next.size === 0) return known;
      return next.size === previous.size && [...next].every((id) => previous.has(id)) ? previous : next;
    });
  }, [profiles]);

  const toggleProfileFilter = useCallback((profileId: string) => {
    setSelectedProfileIds((previous) => {
      const next = new Set(previous);
      // Turning the last one off would show nothing at all — the way to see
      // one profile is to leave one selected, not to select none.
      if (next.has(profileId) && next.size === 1) return previous;
      if (next.has(profileId)) next.delete(profileId);
      else next.add(profileId);
      return next;
    });
  }, []);

  const clearProfileFilter = useCallback(() => {
    setSelectedProfileIds(new Set(getProfiles().map((profile) => profile.id)));
  }, []);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Connection state per tab — used by TitleBar/MobileTopBar, which
  // live outside ChatPanel. Fed by `renderPanel`'s `onConnectedChange` below.
  // Keyed by tab id (not a single flag) because desktop's TabGroupLayout keeps
  // every tab's ChatPanel mounted at once (its flat panel layer, see the
  // `key={tab.id}` comment in `renderPanel`): a background tab's `connected`
  // can flip while it's not the active one, and nothing re-fires once it becomes active
  // again. A single flag reset to `false` on every tab switch (the previous
  // approach) got stuck showing "Reconectando…" forever for a tab that was
  // already connected, since its `connected` value wasn't changing anymore
  // to trigger another update.
  const [connectedByTab, setConnectedByTab] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void ensureNotificationPermission();
  }, []);

  // Global search shortcut (Ctrl/Cmd+K), on any screen.
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
  // was active), across all profiles together. Only runs once,
  // while no tab is open yet. The test deep-link via query string
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

  // Pushes a history entry (titlebar Back/Forward) every time the
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
    setDrawerOpen(false);
  }

  /** "Continuar para novo perfil" on `ProfileSetupDialog` — the only place
   * that ever switches to a profile `enqueueProfileSetup` just set up.
   * Order matters: `handleProfileChange` runs first so React has already
   * scheduled the render that makes `useTailnetSidecarOwner` reclaim the
   * tailnet-sidecar reference `profileSetup.ts` is about to hand over,
   * before `completeProfileSetup` releases it (with `HANDOVER_GRACE_MS` to
   * spare). `tabsState.openTab` takes `profileId` explicitly rather than
   * going through `handleNewConversation` — that one reads
   * `activeProfile.id` from the closure, which still has the old value in
   * this same tick. */
  function handleSetupContinue(profileId: string): void {
    handleProfileChange(profileId);
    tabsState.openTab(profileId, crypto.randomUUID(), null, true);
    completeProfileSetup();
  }

  /** "Ir para o perfil existente" on `ProfileSetupDialog`'s duplicate
   * notice — decision 4: normally just drops the freshly claimed duplicate
   * profile, but if the existing one was revoked, migrates the fresh
   * credentials onto its id first (`addProfile` replaces in place) so a
   * dismissed `RevokedProfileBanner` doesn't leave that profile stuck dead.
   * `removeProfile` refusing to empty the list is never a concern here — a
   * duplicate existing means there are already at least two profiles.
   * Ends the setup request via `dismissProfileSetup` (not `completeProfileSetup`):
   * the just-claimed profile is being thrown away, not adopted, so its held
   * tailnet-sidecar reference (if any) should be released right away, with
   * no handover grace. */
  function handleSetupUseExisting(existingId: string): void {
    if (setupSnapshot.state?.status !== "ready") return;
    const newProfile = setupSnapshot.state.profile;

    if (isProfileRevoked(existingId)) {
      addProfile({ ...newProfile, id: existingId });
      clearProfileRevoked(existingId);
    }
    removeProfile(newProfile.id);

    dismissProfileSetup();
    handleProfileChange(existingId);
    tabsState.openTab(existingId, crypto.randomUUID(), null, true);
  }

  // Creates the session implicitly: opens a blank tab right away, without
  // asking for a name — the title is inferred from the first prompt the user
  // sends (the relay fires this in parallel with the turn, see
  // sessionManager.ts). The session only enters the sidebar once that title
  // arrives (ChatPanel's onTitle below), not before.
  function handleNewConversation(): void {
    const id = crypto.randomUUID();
    // Filtered down to exactly one profile, that profile is unambiguously
    // the one being worked in, so a new conversation belongs there. With
    // several selected there is nothing to infer from, and it falls back to
    // the focused tab's profile as before.
    const [onlySelected] = selectedProfileIds;
    const target = selectedProfileIds.size === 1 ? onlySelected : activeProfile.id;
    tabsState.openTab(target, id, null, true);
    setDrawerOpen(false);
  }

  /** The `+` on a group's tab strip. `openTab` always appends to the focused
   * group, so clicking `+` on a strip that isn't focused would otherwise
   * open the tab in the other column. Focusing first works in one click
   * because both are functional updaters on the same `useTabs` state: React
   * batches them and `openTab`'s updater already sees the new
   * `focusedGroupId` — no second render needed in between. */
  function handleNewTabInGroup(groupId: string): void {
    tabsState.focusGroup(groupId);
    handleNewConversation();
  }

  /** A row in the sidebar can belong to any profile now, so this goes
   * through `focusSession` — the same path search and notification clicks
   * already used for "jump to a session that may not be in the current
   * profile". `openTab` records the profile on the tab but does not move
   * `activeProfile` on its own, and leaving that behind would keep the live
   * `/sessions/watch` socket, the tailnet-sidecar reference and the default
   * target for a new conversation pointing at the profile the user just
   * navigated away from. */
  function handleSelectSession(session: MergedSession): void {
    focusSession(session.profileId, session.id, session.title);
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

  // Deep-link profile import (`anywh://import-profile`) — see
  // useProfileImport.ts. Only feeds the profileSetup.ts queue now; nothing
  // switches profile until the user clicks "Continuar" on ProfileSetupDialog
  // below (decision 1 — the old silent auto-switch is gone).
  useProfileImport();
  const setupSnapshot = useProfileSetup();

  /** Explicit `profileId` (not always `activeProfile`) for the same reason as
   * `handleDeleteSession` right below: it's also called from a tab belonging
   * to a profile other than the one currently selected in the sidebar. */
  function handleRenameSession(profileId: string, id: string, title: string): void {
    const profile = findProfile(profileId);
    if (!profile) return;
    resolveConnection(profile)
      .then(({ host, port, token }) => renameSession(host, port, id, title, token))
      .then(() => {
        tabsState.setTabTitle(id, title);
        upsertCachedSession(profileId, id, title);
      })
      .catch((error: unknown) => {
        console.error("[anywh] failed to rename session", error);
        window.alert("Não foi possível renomear a sessão.");
      });
  }

  /** Only removes the session from anywh's control — doesn't delete the
   * transcript that Claude Code already keeps on its own. Explicit
   * `profileId` (not always `activeProfile`) because it's also called from a
   * tab belonging to a profile other than the one currently selected in the
   * sidebar. */
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
        removeCachedSession(profileId, id);
      })
      .catch((error: unknown) => {
        console.error("[anywh] failed to delete session", error);
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

  // Embedded terminal — desktop only (the original screenshot/flow
  // is clearly desktop, iOS is left out for now, same gate that voice/titlebar
  // already use).
  function handleToggleTerminalPanel(): void {
    if (isCompact || isIOS() || !activeTabId) return;
    sessionDock.togglePane(activeTabId, "terminal");
  }

  // Work dir file panel — same desktop-only gate as the terminal.
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
  // Cycles within the focused group only — with more than one group open,
  // cycling through every tab in the app regardless of which group it's in
  // would jump the view to a different group out from under Ctrl+Tab, which
  // isn't what "next tab" means once tabs are split into columns.
  function handleCycleTab(direction: 1 | -1): void {
    const focusedGroup = tabsState.groups.find((group) => group.id === tabsState.focusedGroupId);
    if (!focusedGroup || focusedGroup.tabIds.length < 2) return;
    const currentIndex = focusedGroup.tabIds.indexOf(focusedGroup.activeTabId ?? "");
    if (currentIndex === -1) return;
    const nextIndex = (currentIndex + direction + focusedGroup.tabIds.length) % focusedGroup.tabIds.length;
    tabsState.setActiveTab(focusedGroup.tabIds[nextIndex]);
  }

  // `Ctrl+\` (VS Code's own "split editor") — moves the focused group's
  // active tab into a new group immediately to its right. Desktop only, same
  // gate as the dock: on compact/iOS there's only ever one group (point 12
  // of the split design — narrow viewports fall back to one flat strip), so
  // splitting wouldn't have anywhere to put a second column anyway.
  function handleSplitActiveTab(): void {
    if (isCompact || isIOS() || !activeTabId) return;
    tabsState.splitTabToNewGroup(activeTabId, tabsState.focusedGroupId);
  }

  // Ctrl+1/2/3 — focuses the Nth group left to right. No-op past however
  // many groups are actually open (never more than MAX_GROUPS anyway).
  function handleFocusGroupByIndex(index: number): void {
    const group = tabsState.groups[index];
    if (group) tabsState.focusGroup(group.id);
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
      // `Ctrl+\` — VS Code's own "split editor" shortcut, literal Ctrl even
      // on macOS, same reasoning as `Ctrl+\`` above (distinct key: backslash,
      // not backtick).
      if (event.ctrlKey && event.key === "\\") {
        event.preventDefault();
        handleSplitActiveTab();
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
        case "1":
        case "2":
        case "3":
          event.preventDefault();
          handleFocusGroupByIndex(Number(event.key) - 1);
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
    tabsState.splitTabToNewGroup,
    tabsState.focusGroup,
    tabsState.focusedGroupId,
    tabsState.groups,
    resizable.toggleCollapsed,
  ]);

  // Every profile's running sessions, not just the selected profile's — the
  // sidebar lists them all now, and a turn running in another profile's tab
  // is exactly the kind of thing the indicator exists to surface.
  //
  // Still only covers sessions open as a tab: a session with no tab has no
  // live WS connection to know whether it's running, the same limitation
  // `isRunning` always had.
  const runningSessions = new Set(tabsState.tabs.filter((tab) => tab.isRunning).map((tab) => tab.id));
  const backgroundJobSessions = new Set(tabsState.tabs.filter((tab) => tab.hasBackgroundJob).map((tab) => tab.id));

  const sidebarProps = {
    activeProfile,
    profiles,
    profilesSupported,
    onProfileChange: handleProfileChange,
    selectedProfileIds,
    onToggleProfileFilter: toggleProfileFilter,
    onClearProfileFilter: clearProfileFilter,
    sessions,
    sessionsLoading,
    sessionsError,
    onRetrySessions: reloadSessions,
    selectedSession: activeTabId,
    runningSessions,
    backgroundJobSessions,
    onSelectSession: handleSelectSession,
    onNewConversation: handleNewConversation,
    onRenameSession: (session: MergedSession, title: string) =>
      handleRenameSession(session.profileId, session.id, title),
    onDeleteSession: (session: MergedSession) => handleDeleteSession(session.profileId, session.id),
  };

  const activeTab = tabsState.tabs.find((tab) => tab.id === activeTabId);

  // A tab can belong to any profile — each one's `ChatPanel` uses
  // the profile recorded on the tab itself, not the profile currently
  // selected in the sidebar.
  const renderPanel = (tab: Tab) => {
    const profile = findProfile(tab.profileId) ?? getProfiles()[0];
    const dock = sessionDock.getDock(tab.id);
    // Two different gates, now that a group split can put more than one tab
    // on screen at once: `isVisible` is "this tab is the active one of its
    // own group" (drives panel visibility, dock mounting, MessageLog's
    // scroll re-sync, and the native drag-drop guard below) — up to one per
    // group can be true simultaneously. `isFocused` narrows that to "...and
    // that group is also the one the user's actually interacting with right
    // now" (drives unread-badge clearing, TitleBar.connected, nav history) —
    // at most one tab in the whole app.
    const isVisible = tabsState.visibleTabIds.has(tab.id);
    const chatContent = (
      <ChatPanel
        // On iOS (no TabGroupLayout/flat panel layer), `activeTab && renderPanel(activeTab)`
        // is a single JSX slot whose `sessionId` just changes value — without
        // a `key` tied to the session, React reuses the same instance when
        // switching conversations (only updates props), and internal state
        // (useMessageLog etc.) doesn't reset on its own. `onReconnecting`
        // doesn't help here: it only fires on a real reconnection of the SAME
        // RelayClient instance, not when useRelayClient swaps sessionId and
        // creates a new instance. The result was a real bug: clicking "+"
        // would open a genuinely new session (connecting,
        // "Reconnecting"→"Connected") but the screen kept showing the
        // previous conversation's log. On desktop this didn't happen
        // (TabGroupLayout's flat panel layer already has `key={tab.id}` on
        // each tab's panel wrapper) — here it's just made explicit in the
        // same spot.
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
          notifyTurnComplete(tab.id, profile, tab.title ?? dict.common.untitledSession, lastUserText, lastAssistantText, stopped);
        }}
        onTitle={(title) => {
          tabsState.setTabTitle(tab.id, title);
          // Ungated on the active profile, unlike before: with every profile
          // in one list, a conversation titled in a background tab has to
          // appear under its own profile whether or not that profile is the
          // one currently selected.
          upsertCachedSession(tab.profileId, tab.id, title, Date.now());
        }}
        onActivity={() => {
          touchCachedSession(tab.profileId, tab.id);
        }}
        onDeleted={() => {
          tabsState.closeTab(tab.id);
          sessionDock.removeSession(tab.id);
          terminalTabs.removeSession(tab.id);
          fileTabs.removeSession(tab.id);
          removeCachedSession(tab.profileId, tab.id);
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
        isActiveTab={isVisible}
        isFocusedTab={tab.id === activeTabId}
      />
    );

    if (isCompact || isIOS()) return chatContent;

    // Embedded terminal and files pane, desktop only.
    // `isVisible` is what implements "switching to another tab in this same
    // group closes the dock on its own, coming back reopens it the way it
    // was": `TabGroupLayout` keeps ALL tabs mounted in the background (its
    // flat panel layer, to keep the chat WS alive — see comment further
    // below), so without this gate the dock's panes would stay connected for
    // every backgrounded tab too. Only each group's own visible tab actually
    // mounts `SessionDock`; the others don't even exist in the DOM, so they
    // don't open any terminal/watch WS either. With up to 3 groups now, that
    // means up to 3 live docks at once (up to 3 terminal + 3 watch WS) — not
    // the single live dock this comment used to promise back when there was
    // only ever one active tab in the whole app.
    //
    // The gate here doesn't include `dock.panes.length === 0` — that's how
    // the open/close animation (same as the left sidebar's,
    // useResizableSidebar) works: `SessionDock` stays mounted the whole time
    // the tab is visible, and IT (internally, lightweight) is what decides
    // the width (0 closed, animating to `dock.width` when open). Without this
    // the dock's content only existed in the DOM while open — there was
    // nothing for the CSS transition to animate, it just popped in/out.
    const chatHidden = isVisible && dock.maximized !== null;

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
         * trick (and same reason) as `TabGroupLayout.tsx`'s flat panel layer: `MessageLog`
         * uses `@tanstack/react-virtual`, whose `ResizeObserver` corrupts the
         * height cache if the container measures size 0 even briefly (which
         * is exactly what would happen when maximizing a pane if the chat
         * were hidden via `display:none`/zero width). */}
        <div className={cn("min-w-0 flex-1", chatHidden && "invisible absolute inset-0")}>{chatContent}</div>
        {isVisible && (
          <SessionDock
            dock={dock}
            onWidthChange={(width) => sessionDock.setWidth(tab.id, width)}
            onSplitRatioChange={(ratio) => sessionDock.setSplitRatio(tab.id, ratio)}
            onDragEnd={sessionDock.commitDock}
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
  // on real WebKit (real bug, reproduced via Playwright WebKit).
  // Any `position: static` div in this chain up to `.mobile-canvas` breaks
  // the blur. Don't remove it even though it looks redundant — harmless for
  // desktop (doesn't change position/size of anything).
  const tabsContent = (
    <div className="relative min-h-0 flex-1">
      {tabsState.tabs.length === 0 ? (
        <EmptyState />
      ) : isIOS() ? (
        // iOS: the MVP is one session in focus at a time,
        // without keeping several WebSocket connections alive in parallel in
        // the background — only mounts the active session, without
        // TabGroupLayout's tab mechanism (forceMount/dnd-kit, designed for
        // desktop).
        activeTab && renderPanel(activeTab)
      ) : (
        <TabGroupLayout
          tabs={tabsState.tabs}
          groups={tabsState.groups}
          activeTabId={activeTabId}
          splitEnabled={!isCompact}
          onSelect={tabsState.setActiveTab}
          onFocusGroup={tabsState.focusGroup}
          onNewTab={handleNewTabInGroup}
          onClose={tabsState.closeTab}
          onMoveTab={tabsState.moveTab}
          onSplitTabToNewGroup={tabsState.splitTabToNewGroup}
          onCommitSizes={tabsState.setGroupSizes}
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

  // Mounted in both layout branches below — iOS has no `ProfileSwitcher`
  // (the only other UI that used to trigger a profile import) to hang this
  // off of, and the desktop sidebar unmounts entirely while collapsed, same
  // reasoning `RevokedProfileBanners` follows.
  const profileSetupDialog = (
    <ProfileSetupDialog
      state={setupSnapshot.state}
      queuedCount={setupSnapshot.queuedCount}
      onContinue={handleSetupContinue}
      onUseExisting={handleSetupUseExisting}
      onRetry={retryProfileSetup}
      onDismiss={dismissProfileSetup}
    />
  );

  if (isIOS()) {
    return (
      // `h-full`, not `h-screen`/`h-dvh` — both are independent viewport-height
      // calculations that can disagree with the `body { position: fixed; inset: 0 }`
      // hack in index.css (already pinned to the real visible viewport). `h-full`
      // instead inherits that exact box via `#app { height: 100% }` (found live
      // testing `ChoiceCard` clipping/leaving a gap under the composer on iOS).
      <div className="flex h-full w-screen flex-col overflow-hidden bg-background text-foreground">
        <RevokedProfileBanners />
        {profileSetupDialog}
        <SessionSearch open={searchOpen} onOpenChange={setSearchOpen} onSelectSession={handleSearchSelectSession} />
        <MobileShell
          activeProfile={activeProfile}
          profiles={profiles}
          onProfileChange={handleProfileChange}
          sessions={sessions}
          sessionsLoading={sessionsLoading}
          sessionsError={sessionsError}
          onRetrySessions={reloadSessions}
          selectedSession={activeTabId}
          runningSessions={runningSessions}
          backgroundJobSessions={backgroundJobSessions}
          onSelectSession={handleSelectSession}
          onRenameSession={(session, title) => handleRenameSession(session.profileId, session.id, title)}
          onDeleteSession={(session) => handleDeleteSession(session.profileId, session.id)}
          onOpenSearch={() => setSearchOpen(true)}
          title={activeTab?.title ?? dict.common.untitledSession}
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
      {profileSetupDialog}
      <DownloadToasts />

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

        {/* Inside the main column, not above it: the notice is about a
         * profile's connection, and the conversation and panels are what
         * stop working. The session list keeps working — its rows are cached
         * locally and still readable — so covering it would claim otherwise. */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <RevokedProfileBanners />
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
