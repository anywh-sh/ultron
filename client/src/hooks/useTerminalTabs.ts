import { useCallback, useEffect, useState } from "react";

export interface TerminalTab {
  id: string;
  label: string;
}

interface TerminalTabsState {
  tabs: TerminalTab[];
  activeTerminalId: string | null;
  /** Never reused — closing "Terminal 1" and opening another one gives "Terminal 2",
   * not "Terminal 1" again (simpler to reason about than VS Code's scheme of
   * reusing numbers, and avoids two ghost tabs with the same
   * name briefly coexisting during a quick swap). */
  nextNumber: number;
}

const STORAGE_KEY = "ultron:terminal-tabs";
const EMPTY_STATE: TerminalTabsState = { tabs: [], activeTerminalId: null, nextNumber: 1 };

type TerminalTabsMap = Record<string, TerminalTabsState>;

function loadPersisted(): TerminalTabsMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as TerminalTabsMap;
  } catch {
    return {};
  }
}

/**
 * List of terminal tabs per chat session — content specific to the panel's
 * `kind: "terminal"` (see useSessionDock.ts), deliberately separated from it:
 * the panel shell doesn't need to know that the terminal has multiple
 * internal tabs, that's just a detail of the content it hosts.
 */
export function useTerminalTabs() {
  const [state, setState] = useState<TerminalTabsMap>(loadPersisted);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const getTabs = useCallback((tabId: string): TerminalTabsState => state[tabId] ?? EMPTY_STATE, [state]);

  /** Returns the id generated right away (doesn't wait for the next render) — the caller
   * (the terminal button or the tab strip's "+") needs it immediately
   * to mark the new tab as active. */
  const addTerminal = useCallback((tabId: string): string => {
    const id = crypto.randomUUID();
    setState((prev) => {
      const existing = prev[tabId] ?? EMPTY_STATE;
      const label = `Terminal ${existing.nextNumber}`;
      return {
        ...prev,
        [tabId]: {
          tabs: [...existing.tabs, { id, label }],
          activeTerminalId: id,
          nextNumber: existing.nextNumber + 1,
        },
      };
    });
    return id;
  }, []);

  const closeTerminal = useCallback((tabId: string, terminalId: string) => {
    setState((prev) => {
      const existing = prev[tabId];
      if (!existing) return prev;
      const tabs = existing.tabs.filter((tab) => tab.id !== terminalId);
      const activeTerminalId =
        existing.activeTerminalId === terminalId ? (tabs[tabs.length - 1]?.id ?? null) : existing.activeTerminalId;
      return { ...prev, [tabId]: { ...existing, tabs, activeTerminalId } };
    });
  }, []);

  const setActiveTerminal = useCallback((tabId: string, terminalId: string) => {
    setState((prev) => {
      const existing = prev[tabId];
      if (!existing) return prev;
      return { ...prev, [tabId]: { ...existing, activeTerminalId: terminalId } };
    });
  }, []);

  /** Called when the chat tab is closed/deleted — same cleanup as
   * `useSessionDock.removeSession`. Doesn't kill the tmux processes (that's the
   * relay's responsibility, notified separately via `/sessions/delete`
   * or `/terminals/close`); here it's just the UI forgetting the local list. */
  const removeSession = useCallback((tabId: string) => {
    setState((prev) => {
      if (!(tabId in prev)) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
  }, []);

  return { getTabs, addTerminal, closeTerminal, setActiveTerminal, removeSession };
}
