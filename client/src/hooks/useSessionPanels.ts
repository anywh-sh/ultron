import { useCallback, useEffect, useState } from "react";

/** Painel lateral direito genérico, um por sessão de chat (aba) — hoje só
 * existe o conteúdo "terminal", mas o formato já separa a casca (aberto,
 * largura, maximizado) do conteúdo (`kind`) porque o visualizador de
 * arquivos do work dir (planejado, ainda não implementado) vai reaproveitar
 * a mesma gaveta: os dois nunca ficam abertos ao mesmo tempo pra uma
 * sessão, é literalmente o mesmo slot trocando de conteúdo, não dois
 * painéis independentes.
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
 * Estado de todos os painéis direitos do app, um por aba de sessão —
 * mesmo padrão de `useTabs.ts` (um mapa em vez de instâncias separadas),
 * persistido em `localStorage` pra sobreviver a restart do app. Puramente
 * estado de UI (aberto/largura/maximizado): o que existe *dentro* do painel
 * (ex: quais abas de terminal) é responsabilidade de outro hook
 * (`useTerminalTabs`), este aqui só sabe da casca.
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

  /** Chamado quando a aba de chat é fechada/excluída — sem isso o mapa cresce
   * pra sempre com entradas de sessões que não existem mais. */
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
