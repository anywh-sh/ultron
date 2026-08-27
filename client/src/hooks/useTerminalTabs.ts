import { useCallback, useEffect, useState } from "react";

export interface TerminalTab {
  id: string;
  label: string;
}

interface TerminalTabsState {
  tabs: TerminalTab[];
  activeTerminalId: string | null;
  /** Nunca reaproveitado — fechar "Terminal 1" e abrir outro dá "Terminal 2",
   * não "Terminal 1" de novo (mais simples de raciocinar que o esquema de
   * reaproveitar número do VS Code, e evita duas abas fantasmas com o mesmo
   * nome coexistindo brevemente durante uma troca rápida). */
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
 * Lista de abas de terminal por sessão de chat — conteúdo específico do
 * `kind: "terminal"` do painel (ver useSessionPanels.ts), separado dele de
 * propósito: a casca do painel não precisa saber que terminal tem múltiplas
 * abas internas, isso é só um detalhe do conteúdo que ela hospeda.
 */
export function useTerminalTabs() {
  const [state, setState] = useState<TerminalTabsMap>(loadPersisted);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const getTabs = useCallback((tabId: string): TerminalTabsState => state[tabId] ?? EMPTY_STATE, [state]);

  /** Devolve o id gerado na hora (não espera o próximo render) — quem chama
   * (o botão de terminal ou o "+" da tira de abas) precisa dele de imediato
   * pra marcar a aba nova como ativa. */
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

  /** Chamado quando a aba de chat é fechada/excluída — mesma limpeza de
   * `useSessionPanels.removePanel`. Não mata os processos tmux (isso é
   * responsabilidade do relay, avisado separadamente via `/sessions/delete`
   * ou `/terminals/close`); aqui é só a UI esquecendo a lista local. */
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
