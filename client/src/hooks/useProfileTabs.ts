import { useCallback, useEffect, useState } from "react";
import { arrayMove } from "@dnd-kit/sortable";

export interface Tab {
  id: string;
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
  title: string | null;
}

interface PersistedTabs {
  tabs: PersistedTab[];
  activeTabId: string | null;
}

type ByProfile = Record<string, TabsState>;

const EMPTY_STATE: TabsState = { tabs: [], activeTabId: null };

function lastSessionKey(profileId: string): string {
  return `ultron:last-session:${profileId}`;
}

function tabsOrderKey(profileId: string): string {
  return `ultron:tabs:${profileId}`;
}

/** Formato salvo antes da separação id/título: array de strings, onde a
 * string era ao mesmo tempo o id e o título exibido. */
function isLegacyPersistedTabs(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/**
 * Estado de abas de TODOS os perfis, não só do ativo — abas de um perfil
 * em segundo plano continuam montadas (conexão WS viva) quando o usuário
 * troca de perfil, conforme docs/18. `App` decide o que renderizar visível
 * combinando o perfil ativo com a aba ativa daquele perfil.
 *
 * `App` chama este hook antes dos próprios efeitos (restauração de abas no
 * mount) — a ordem importa: garante que o efeito de persistência abaixo rode
 * primeiro a cada flush, o que fecha a corrida entre persistir e restaurar
 * em 2 renders sem loop (ver efeito de persistência).
 */
export function useProfileTabs() {
  const [byProfile, setByProfile] = useState<ByProfile>({});

  // Persiste lista de abas (id + título, pra restaurar sem esperar um
  // refetch) + ordem + aba ativa por perfil. Itera `Object.keys(byProfile)`
  // — NUNCA a lista estática de perfis conhecidos. Um profileId só vira
  // chave real depois de alguma ação (openTab etc). Iterar todos os perfis
  // conhecidos aqui gravaria estado vazio pros dois já no primeiro render,
  // ANTES da restauração (em App) rodar, apagando o que tinha sido
  // persistido antes de dar tempo de ler.
  useEffect(() => {
    for (const profileId of Object.keys(byProfile)) {
      const { tabs, activeTabId } = byProfile[profileId];
      const persisted: PersistedTab[] = tabs.map((tab) => ({ id: tab.id, title: tab.title }));
      localStorage.setItem(tabsOrderKey(profileId), JSON.stringify(persisted));
      if (activeTabId) localStorage.setItem(lastSessionKey(profileId), activeTabId);
    }
  }, [byProfile]);

  const getTabs = useCallback((profileId: string): TabsState => byProfile[profileId] ?? EMPTY_STATE, [byProfile]);

  const openTab = useCallback((profileId: string, id: string, title: string | null = null, isNew = false) => {
    setByProfile((prev) => {
      const current = prev[profileId] ?? EMPTY_STATE;
      const exists = current.tabs.some((tab) => tab.id === id);
      const tabs = exists
        ? current.tabs
        : [...current.tabs, { id, title, hasUnreadCompletion: false, isRunning: false, isNew }];
      return { ...prev, [profileId]: { tabs, activeTabId: id } };
    });
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
  }, []);

  const reorderTabs = useCallback((profileId: string, activeTabId: string, overTabId: string) => {
    setByProfile((prev) => {
      const current = prev[profileId];
      if (!current) return prev;
      const oldIndex = current.tabs.findIndex((tab) => tab.id === activeTabId);
      const newIndex = current.tabs.findIndex((tab) => tab.id === overTabId);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return prev;
      return { ...prev, [profileId]: { ...current, tabs: arrayMove(current.tabs, oldIndex, newIndex) } };
    });
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

  const setRunning = useCallback((profileId: string, tabId: string, value: boolean) => {
    setByProfile((prev) => {
      const current = prev[profileId];
      const tab = current?.tabs.find((t) => t.id === tabId);
      if (!current || !tab || tab.isRunning === value) return prev;
      return {
        ...prev,
        [profileId]: {
          ...current,
          tabs: current.tabs.map((t) => (t.id === tabId ? { ...t, isRunning: value } : t)),
        },
      };
    });
  }, []);

  /** Chamado quando o título de uma sessão passa a existir ou muda — tanto
   * pela inferência automática do primeiro prompt (ChatPanel, ao vivo via
   * WS) quanto por um rename manual feito na sidebar. No-op se a sessão não
   * estiver aberta como aba nesse perfil agora (ex: rename de uma sessão
   * fechada) — o próprio bailout de `setUnread`/`setRunning` acima. */
  const setTabTitle = useCallback((profileId: string, tabId: string, title: string) => {
    setByProfile((prev) => {
      const current = prev[profileId];
      const tab = current?.tabs.find((t) => t.id === tabId);
      if (!current || !tab || tab.title === title) return prev;
      return {
        ...prev,
        [profileId]: {
          ...current,
          tabs: current.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)),
        },
      };
    });
  }, []);

  const getLastSession = useCallback((profileId: string): string | null => {
    return localStorage.getItem(lastSessionKey(profileId));
  }, []);

  const getPersistedTabs = useCallback((profileId: string): PersistedTabs | null => {
    const raw = localStorage.getItem(tabsOrderKey(profileId));
    if (raw === null) {
      // Chave nova nunca existiu (usuário vem de antes desta mudança): cai
      // pro que já era persistido, uma única sessão (nome antigo = id e
      // título, mesma regra de migração do SessionStore no relay).
      const lastSession = localStorage.getItem(lastSessionKey(profileId));
      return lastSession
        ? { tabs: [{ id: lastSession, title: lastSession }], activeTabId: lastSession }
        : null;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      const tabs: PersistedTab[] = isLegacyPersistedTabs(parsed)
        ? parsed.map((name) => ({ id: name, title: name }))
        : (parsed as PersistedTab[]);
      if (tabs.length === 0) return null;
      const activeTabId = localStorage.getItem(lastSessionKey(profileId));
      return { tabs, activeTabId: activeTabId && tabs.some((t) => t.id === activeTabId) ? activeTabId : null };
    } catch {
      return null;
    }
  }, []);

  const restoreTabs = useCallback((profileId: string, persistedTabs: PersistedTab[], activeTabId: string | null) => {
    setByProfile((prev) => {
      const tabs = persistedTabs.map((persisted) => ({
        id: persisted.id,
        title: persisted.title,
        hasUnreadCompletion: false,
        isRunning: false,
        isNew: false,
      }));
      return { ...prev, [profileId]: { tabs, activeTabId: activeTabId ?? tabs[tabs.length - 1]?.id ?? null } };
    });
  }, []);

  return {
    byProfile,
    getTabs,
    openTab,
    closeTab,
    setActiveTab,
    setUnread,
    setRunning,
    setTabTitle,
    reorderTabs,
    getLastSession,
    getPersistedTabs,
    restoreTabs,
  };
}
