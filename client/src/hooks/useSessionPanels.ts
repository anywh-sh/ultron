import { useCallback, useEffect, useState } from "react";

/** Generic right-side panel, one per chat session (tab) — today only
 * the "terminal" content exists, but the format already separates the shell (open,
 * width, maximized) from the content (`kind`) because the work dir's
 * file viewer (planned, not implemented yet) will reuse
 * the same drawer: the two are never open at the same time for a
 * session, it's literally the same slot swapping content, not two
 * independent panels.
 */
export type SessionPanelKind = "terminal";

export interface SessionPanelState {
  open: boolean;
  kind: SessionPanelKind;
  width: number;
  maximized: boolean;
}

const MIN_WIDTH = 320;
const MAX_WIDTH = 900;
const DEFAULT_WIDTH = 480;

const STORAGE_KEY = "ultron:session-panels";

type PanelMap = Record<string, SessionPanelState>;

function clampWidth(width: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
}

function loadPersisted(): PanelMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as PanelMap;
  } catch {
    return {};
  }
}

const EMPTY_PANEL: SessionPanelState = { open: false, kind: "terminal", width: DEFAULT_WIDTH, maximized: false };

/**
 * State of all the app's right-side panels, one per session tab —
 * same pattern as `useTabs.ts` (a map instead of separate instances),
 * persisted in `localStorage` to survive an app restart. Purely
 * UI state (open/width/maximized): what exists *inside* the panel
 * (e.g. which terminal tabs) is another hook's responsibility
 * (`useTerminalTabs`), this one only knows about the shell.
 */
export function useSessionPanels() {
  const [panels, setPanels] = useState<PanelMap>(loadPersisted);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(panels));
  }, [panels]);

  const getPanel = useCallback((tabId: string): SessionPanelState => panels[tabId] ?? EMPTY_PANEL, [panels]);

  const openPanel = useCallback((tabId: string, kind: SessionPanelKind) => {
    setPanels((prev) => ({ ...prev, [tabId]: { ...(prev[tabId] ?? EMPTY_PANEL), open: true, kind } }));
  }, []);

  const closePanel = useCallback((tabId: string) => {
    setPanels((prev) => {
      const existing = prev[tabId];
      if (!existing?.open) return prev;
      return { ...prev, [tabId]: { ...existing, open: false } };
    });
  }, []);

  const togglePanel = useCallback((tabId: string, kind: SessionPanelKind) => {
    setPanels((prev) => {
      const existing = prev[tabId] ?? EMPTY_PANEL;
      return { ...prev, [tabId]: { ...existing, kind, open: !existing.open } };
    });
  }, []);

  const setWidth = useCallback((tabId: string, width: number) => {
    setPanels((prev) => {
      const existing = prev[tabId];
      if (!existing) return prev;
      return { ...prev, [tabId]: { ...existing, width: clampWidth(width) } };
    });
  }, []);

  const toggleMaximized = useCallback((tabId: string) => {
    setPanels((prev) => {
      const existing = prev[tabId];
      if (!existing) return prev;
      return { ...prev, [tabId]: { ...existing, maximized: !existing.maximized } };
    });
  }, []);

  /** Called when the chat tab is closed/deleted — without this the map keeps
   * growing forever with entries for sessions that no longer exist. */
  const removePanel = useCallback((tabId: string) => {
    setPanels((prev) => {
      if (!(tabId in prev)) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
  }, []);

  return { getPanel, openPanel, closePanel, togglePanel, setWidth, toggleMaximized, removePanel };
}
