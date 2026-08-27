import { useCallback, useEffect, useRef, useState } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import { PROFILES } from "@/lib/profiles";

export interface Tab {
  id: string;
  profileId: string;
  /** `null` até o título ser inferido do primeiro prompt — a aba mostra um
   * placeholder genérico nesse meio-tempo (ver TabBar). */
  title: string | null;
  hasUnreadCompletion: boolean;
  isRunning: boolean;
  /** `true` só pra abas abertas via "nova conversa" — usado pelo ChatPanel
   * pra mostrar o estado ocioso em vez do skeleton de carregamento enquanto
   * não há nenhuma mensagem: não existe histórico pra esperar. Fica `true`
   * pelo resto da vida da aba, mas só é consultado enquanto o log está
   * vazio, então perde efeito sozinho após a primeira mensagem. */
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

/** Chaves de quando abas eram separadas por perfil (docs/28 e antes) — usadas
 * só como fallback de migração pra quem já tinha abas salvas de antes da
 * fusão numa aba só (docs/29). */
function legacyTabsKey(profileId: string): string {
  return `ultron:tabs:${profileId}`;
}
function legacyLastSessionKey(profileId: string): string {
  return `ultron:last-session:${profileId}`;
}

/** Formato salvo antes da separação id/título: array de strings, onde a
 * string era ao mesmo tempo o id e o título exibido. */
function isLegacyPersistedTabs(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/** Lê o formato antigo (uma lista de abas por perfil) e devolve tudo já
 * combinado numa lista só, cada aba tagueada com o `profileId` de onde veio.
 * Só roda quando a chave nova (`TABS_KEY`) ainda não existe. */
function migrateLegacyTabs(): PersistedTabs | null {
  const allTabs: PersistedTab[] = [];
  let activeTabId: string | null = null;

  for (const profile of PROFILES) {
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
      // ignora blob corrompido de um perfil, continua com os outros
    }
  }

  return allTabs.length > 0 ? { tabs: allTabs, activeTabId } : null;
}

/**
 * Estado de abas do app inteiro (docs/29) — sem separação por perfil: cada
 * aba carrega seu próprio `profileId`, então abas de perfis diferentes
 * convivem na mesma tira, com uma única aba ativa global. Todas ficam
 * montadas o tempo todo (conexão WS viva mesmo em segundo plano), igual já
 * acontecia antes por perfil.
 */
export function useTabs() {
  const [state, setState] = useState<TabsState>({ tabs: [], activeTabId: null });
  // Vira `true` assim que a lista deixa de ser o placeholder inicial do
  // mount (via restauração ou primeira aba aberta) — evita que o efeito de
  // persistência abaixo grave `[]` por cima do que já estava salvo antes de
  // `App` rodar o efeito de restauração (que roda depois deste, ver ordem
  // dos hooks).
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
        : [...prev.tabs, { id, profileId, title, hasUnreadCompletion: false, isRunning: false, isNew }];
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
      // Sem mudança real: devolve a MESMA referência de `prev` — React pula o
      // re-render (bailout), evitando loop com o efeito que limpa o badge
      // toda vez que a aba ativa muda.
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

  /** Chamado quando o título de uma sessão passa a existir ou muda — tanto
   * pela inferência automática do primeiro prompt (ChatPanel, ao vivo via
   * WS) quanto por um rename manual feito na sidebar. No-op se a sessão não
   * estiver aberta como aba agora (ex: rename de uma sessão fechada) — o
   * próprio bailout de `setUnread`/`setRunning` acima. */
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
    setTabTitle,
    reorderTabs,
    getPersistedTabs,
    restoreTabs,
  };
}
