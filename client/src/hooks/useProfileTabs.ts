import { useCallback, useState } from "react";

export interface Tab {
  id: string;
  sessionName: string;
  hasUnreadCompletion: boolean;
}

interface TabsState {
  tabs: Tab[];
  activeTabId: string | null;
}

type ByProfile = Record<string, TabsState>;

const EMPTY_STATE: TabsState = { tabs: [], activeTabId: null };

function lastSessionKey(profileId: string): string {
  return `ultron:last-session:${profileId}`;
}

/**
 * Estado de abas de TODOS os perfis, não só do ativo — abas de um perfil
 * em segundo plano continuam montadas (conexão WS viva) quando o usuário
 * troca de perfil, conforme docs/18. `App` decide o que renderizar visível
 * combinando o perfil ativo com a aba ativa daquele perfil.
 */
export function useProfileTabs() {
  const [byProfile, setByProfile] = useState<ByProfile>({});

  const getTabs = useCallback((profileId: string): TabsState => byProfile[profileId] ?? EMPTY_STATE, [byProfile]);

  const openTab = useCallback((profileId: string, sessionName: string) => {
    setByProfile((prev) => {
      const current = prev[profileId] ?? EMPTY_STATE;
      const exists = current.tabs.some((tab) => tab.sessionName === sessionName);
      const tabs = exists
        ? current.tabs
        : [...current.tabs, { id: sessionName, sessionName, hasUnreadCompletion: false }];
      return { ...prev, [profileId]: { tabs, activeTabId: sessionName } };
    });
    localStorage.setItem(lastSessionKey(profileId), sessionName);
  }, []);

  const closeTab = useCallback((profileId: string, tabId: string) => {
    setByProfile((prev) => {
      const current = prev[profileId];
      if (!current) return prev;
      const tabs = current.tabs.filter((tab) => tab.id !== tabId);
      const activeTabId = current.activeTabId === tabId ? (tabs[tabs.length - 1]?.id ?? null) : current.activeTabId;
      return { ...prev, [profileId]: { tabs, activeTabId } };
    });
  }, []);

  const setActiveTab = useCallback((profileId: string, tabId: string) => {
    setByProfile((prev) => {
      const current = prev[profileId] ?? EMPTY_STATE;
      return { ...prev, [profileId]: { ...current, activeTabId: tabId } };
    });
    localStorage.setItem(lastSessionKey(profileId), tabId);
  }, []);

  const setUnread = useCallback((profileId: string, tabId: string, value: boolean) => {
    setByProfile((prev) => {
      const current = prev[profileId];
      const tab = current?.tabs.find((t) => t.id === tabId);
      // Sem mudança real: devolve a MESMA referência de `prev` — React pula o
      // re-render (bailout), evitando loop com o efeito que limpa o badge
      // toda vez que a aba ativa muda.
      if (!current || !tab || tab.hasUnreadCompletion === value) return prev;
      return {
        ...prev,
        [profileId]: {
          ...current,
          tabs: current.tabs.map((t) => (t.id === tabId ? { ...t, hasUnreadCompletion: value } : t)),
        },
      };
    });
  }, []);

  const getLastSession = useCallback((profileId: string): string | null => {
    return localStorage.getItem(lastSessionKey(profileId));
  }, []);

  return { byProfile, getTabs, openTab, closeTab, setActiveTab, setUnread, getLastSession };
}
