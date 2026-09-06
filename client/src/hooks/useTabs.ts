import { useCallback, useEffect, useRef, useState } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import { getProfiles } from "@/lib/profiles";

export interface Tab {
  id: string;
  profileId: string;
  /** `null` until the title is inferred from the first prompt — the tab shows a
   * generic placeholder in the meantime (see TabBar). */
  title: string | null;
  hasUnreadCompletion: boolean;
  isRunning: boolean;
  /** Has an `ultron-bg` job currently observed in this session (docs/32, Phase E) —
   * same pattern as `isRunning`, but for "something running unsupervised in
   * parallel" instead of "the assistant is responding right now". */
  hasBackgroundJob: boolean;
  /** `true` only for tabs opened via "new conversation" — used by ChatPanel
   * to show the idle state instead of the loading skeleton while
   * there's no message yet: there's no history to wait for. Stays `true`
   * for the rest of the tab's life, but is only consulted while the log is
   * empty, so it loses effect on its own after the first message. */
  isNew: boolean;
}

interface TabsState {
  tabs: Tab[];
  activeTabId: string | null;
}

interface PersistedTab {
  id: string;
  profileId: string;
  title: string | null;
}

interface PersistedTabs {
  tabs: PersistedTab[];
  activeTabId: string | null;
}

const TABS_KEY = "ultron:tabs";
const ACTIVE_TAB_KEY = "ultron:active-tab";

/** Keys from when tabs were separated by profile (docs/28 and earlier) — used
 * only as a migration fallback for whoever already had tabs saved from before the
 * merge into a single tab strip (docs/29). */
function legacyTabsKey(profileId: string): string {
  return `ultron:tabs:${profileId}`;
}
function legacyLastSessionKey(profileId: string): string {
  return `ultron:last-session:${profileId}`;
}

/** Format saved before the id/title split: array of strings, where the
 * string was both the id and the displayed title. */
function isLegacyPersistedTabs(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/** Reads the old format (one tab list per profile) and returns everything already
 * combined into a single list, each tab tagged with the `profileId` it came from.
 * Only runs when the new key (`TABS_KEY`) doesn't exist yet. */
function migrateLegacyTabs(): PersistedTabs | null {
  const allTabs: PersistedTab[] = [];
  let activeTabId: string | null = null;

  for (const profile of getProfiles()) {
    const raw = localStorage.getItem(legacyTabsKey(profile.id));
    if (raw === null) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      const tabs: PersistedTab[] = isLegacyPersistedTabs(parsed)
        ? parsed.map((name) => ({ id: name, profileId: profile.id, title: name }))
        : (parsed as Array<{ id: string; title: string | null }>).map((tab) => ({ ...tab, profileId: profile.id }));
      allTabs.push(...tabs);
      const lastSession = localStorage.getItem(legacyLastSessionKey(profile.id));
      if (activeTabId === null && lastSession && tabs.some((tab) => tab.id === lastSession)) {
        activeTabId = lastSession;
      }
    } catch {
      // ignores a corrupted blob for one profile, continues with the others
    }
  }

  return allTabs.length > 0 ? { tabs: allTabs, activeTabId } : null;
}

/**
 * State of the whole app's tabs (docs/29) — no separation by profile: each
 * tab carries its own `profileId`, so tabs from different profiles
 * coexist in the same strip, with a single global active tab. All stay
 * mounted at all times (WS connection alive even in the background), same as
 * used to happen before, per profile.
 */
export function useTabs() {
  const [state, setState] = useState<TabsState>({ tabs: [], activeTabId: null });
  // Becomes `true` as soon as the list stops being the initial mount
  // placeholder (via restoration or first tab opened) — prevents the persistence
  // effect below from writing `[]` over what was already saved before
  // `App` runs the restoration effect (which runs after this one, see hook
  // ordering).
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!hydratedRef.current) return;
    const persisted: PersistedTab[] = state.tabs.map((tab) => ({ id: tab.id, profileId: tab.profileId, title: tab.title }));
    localStorage.setItem(TABS_KEY, JSON.stringify(persisted));
    if (state.activeTabId) localStorage.setItem(ACTIVE_TAB_KEY, state.activeTabId);
  }, [state]);

  const openTab = useCallback((profileId: string, id: string, title: string | null = null, isNew = false) => {
    hydratedRef.current = true;
    setState((prev) => {
      const exists = prev.tabs.some((tab) => tab.id === id);
      const tabs = exists
        ? prev.tabs
        : [...prev.tabs, { id, profileId, title, hasUnreadCompletion: false, isRunning: false, hasBackgroundJob: false, isNew }];
      return { tabs, activeTabId: id };
    });
  }, []);

  const closeTab = useCallback((tabId: string) => {
    setState((prev) => {
      const tabs = prev.tabs.filter((tab) => tab.id !== tabId);
      const activeTabId = prev.activeTabId === tabId ? (tabs[tabs.length - 1]?.id ?? null) : prev.activeTabId;
      return { tabs, activeTabId };
    });
  }, []);

  const setActiveTab = useCallback((tabId: string) => {
    setState((prev) => ({ ...prev, activeTabId: tabId }));
  }, []);

  const reorderTabs = useCallback((activeTabId: string, overTabId: string) => {
    setState((prev) => {
      const oldIndex = prev.tabs.findIndex((tab) => tab.id === activeTabId);
      const newIndex = prev.tabs.findIndex((tab) => tab.id === overTabId);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return prev;
      return { ...prev, tabs: arrayMove(prev.tabs, oldIndex, newIndex) };
    });
  }, []);

  const setUnread = useCallback((tabId: string, value: boolean) => {
    setState((prev) => {
      const tab = prev.tabs.find((t) => t.id === tabId);
      // No real change: returns the SAME `prev` reference — React skips the
      // re-render (bailout), avoiding a loop with the effect that clears the badge
      // every time the active tab changes.
      if (!tab || tab.hasUnreadCompletion === value) return prev;
      return { ...prev, tabs: prev.tabs.map((t) => (t.id === tabId ? { ...t, hasUnreadCompletion: value } : t)) };
    });
  }, []);

  const setRunning = useCallback((tabId: string, value: boolean) => {
    setState((prev) => {
      const tab = prev.tabs.find((t) => t.id === tabId);
      if (!tab || tab.isRunning === value) return prev;
      return { ...prev, tabs: prev.tabs.map((t) => (t.id === tabId ? { ...t, isRunning: value } : t)) };
    });
  }, []);

  const setHasBackgroundJob = useCallback((tabId: string, value: boolean) => {
    setState((prev) => {
      const tab = prev.tabs.find((t) => t.id === tabId);
      if (!tab || tab.hasBackgroundJob === value) return prev;
      return { ...prev, tabs: prev.tabs.map((t) => (t.id === tabId ? { ...t, hasBackgroundJob: value } : t)) };
    });
  }, []);

  /** Called when a session's title comes into existence or changes — either
   * from automatic inference of the first prompt (ChatPanel, live via
   * WS) or from a manual rename done in the sidebar. No-op if the session isn't
   * open as a tab right now (e.g. rename of a closed session) — the
   * same bailout as `setUnread`/`setRunning` above. */
  const setTabTitle = useCallback((tabId: string, title: string) => {
    setState((prev) => {
      const tab = prev.tabs.find((t) => t.id === tabId);
      if (!tab || tab.title === title) return prev;
      return { ...prev, tabs: prev.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)) };
    });
  }, []);

  const getPersistedTabs = useCallback((): PersistedTabs | null => {
    const raw = localStorage.getItem(TABS_KEY);
    if (raw === null) return migrateLegacyTabs();
    try {
      const parsed: unknown = JSON.parse(raw);
      const tabs = parsed as PersistedTab[];
      if (tabs.length === 0) return null;
      const activeTabId = localStorage.getItem(ACTIVE_TAB_KEY);
      return { tabs, activeTabId: activeTabId && tabs.some((t) => t.id === activeTabId) ? activeTabId : null };
    } catch {
      return null;
    }
  }, []);

  const restoreTabs = useCallback((persistedTabs: PersistedTab[], activeTabId: string | null) => {
    hydratedRef.current = true;
    setState(() => {
      const tabs = persistedTabs.map((persisted) => ({
        id: persisted.id,
        profileId: persisted.profileId,
        title: persisted.title,
        hasUnreadCompletion: false,
        isRunning: false,
        hasBackgroundJob: false,
        isNew: false,
      }));
      return { tabs, activeTabId: activeTabId ?? tabs[tabs.length - 1]?.id ?? null };
    });
  }, []);

  return {
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    openTab,
    closeTab,
    setActiveTab,
    setUnread,
    setRunning,
    setHasBackgroundJob,
    setTabTitle,
    reorderTabs,
    getPersistedTabs,
    restoreTabs,
  };
}
