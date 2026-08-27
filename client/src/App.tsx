import { useEffect, useMemo, useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/shell/Sidebar";
import { EmptyState } from "@/components/shell/EmptyState";
import { SessionSearch } from "@/components/shell/SessionSearch";
import { TabBar } from "@/components/shell/TabBar";
import { TitleBar } from "@/components/shell/TitleBar";
import { MobileShell } from "@/components/shell/MobileShell";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { useActiveProfile } from "@/hooks/useActiveProfile";
import { useNavigationHistory } from "@/hooks/useNavigationHistory";
import { useSessionNames } from "@/hooks/useSessionNames";
import { useResizableSidebar } from "@/hooks/useResizableSidebar";
import { useIsCompactViewport } from "@/hooks/useIsCompactViewport";
import { useTabs, type Tab } from "@/hooks/useTabs";
import { useWindowFocus } from "@/hooks/useWindowFocus";
import { PROFILES, findProfile } from "@/lib/profiles";
import { ensureNotificationPermission, notifyTurnComplete } from "@/lib/notifications";
import { deleteSession, renameSession } from "@/lib/relayClient";
import { isIOS } from "@/lib/platform";

/** Override opcional via query string (`?profile=&session=`) — só pra permitir
 * deep-link direto num estado específico em testes via Playwright (docs/13). */
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
  const nav = useNavigationHistory();
  const windowFocused = useWindowFocus();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // Estado de conexão da sessão ativa — só usado pela MobileTopBar do iOS
  // (docs/24), que fica fora do ChatPanel. Alimentado pelo `onConnectedChange`
  // de `renderPanel` abaixo, guardado pelo mesmo padrão de "ainda é a aba
  // visível" que `onTurnComplete` já usa.
  const [activeConnected, setActiveConnected] = useState(false);

  useEffect(() => {
    void ensureNotificationPermission();
  }, []);

  // Atalho global de busca (Ctrl/Cmd+K — docs/21), em qualquer tela.
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

  // Primeiro lançamento: restaura as abas da última vez (lista completa +
  // ordem + qual estava ativa), de todos os perfis juntas (docs/29). Só roda
  // uma vez, enquanto ainda não há nenhuma aba aberta. Deep-link de teste via
  // query string (docs/13) tem prioridade e continua abrindo só a sessão
  // pedida, no perfil indicado (ou no perfil padrão).
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

  // Limpa o badge de "turno concluído" da aba que está visível agora.
  useEffect(() => {
    if (activeTabId) tabsState.setUnread(activeTabId, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId]);

  // Evita mostrar "Conectado" herdado da aba anterior por um instante ao
  // trocar de sessão — o ChatPanel recém-montado reporta o estado real assim
  // que o WebSocket dele conectar (ou não).
  useEffect(() => {
    setActiveConnected(false);
  }, [activeTabId]);

  // Empilha uma entrada de histórico (Back/Forward da titlebar — docs/21)
  // toda vez que a aba ativa muda, exceto quando a mudança veio do próprio
  // goBack/goForward (o hook filtra isso internamente).
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

  // Cria a sessão implicitamente: abre uma aba em branco na hora, sem pedir
  // nome — o título é inferido a partir do primeiro prompt que o usuário
  // mandar (relay dispara isso em paralelo ao turno, ver sessionManager.ts).
  // A sessão só entra na sidebar quando esse título chegar (onTitle do
  // ChatPanel abaixo), não antes.
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

  function handleSearchSelectSession(profileId: string, sessionId: string, title: string): void {
    setActiveProfileId(profileId);
    tabsState.openTab(profileId, sessionId, title);
  }

  function handleRenameSession(id: string, title: string): void {
    renameSession(activeProfile.host, activeProfile.relayPort, id, title)
      .then(() => {
        upsertTitle(id, title);
        tabsState.setTabTitle(id, title);
      })
      .catch((error: unknown) => {
        console.error("[ultron] falha ao renomear sessão", error);
        window.alert("Não foi possível renomear a sessão.");
      });
  }

  /** Só tira a sessão do controle do ultron — não apaga o transcript que o
   * Claude Code já mantém sozinho. `profileId` explícito (não sempre
   * `activeProfile`) porque também é chamado a partir de uma aba de outro
   * perfil que não o selecionado na sidebar agora (docs/29). */
  function handleDeleteSession(profileId: string, id: string): void {
    const profile = findProfile(profileId);
    if (!profile) return;
    deleteSession(profile.host, profile.relayPort, id)
      .then(() => {
        tabsState.closeTab(id);
        if (profileId === activeProfile.id) removeSession(id);
      })
      .catch((error: unknown) => {
        console.error("[ultron] falha ao excluir sessão", error);
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

  // Ctrl+Tab / Ctrl+Shift+Tab, igual navegador — de propósito só `ctrlKey`,
  // não `metaKey || ctrlKey` como os outros atalhos abaixo: no macOS Cmd+Tab
  // é o app switcher do próprio SO (nunca chega no app), então o padrão de
  // verdade pra ciclar abas lá também é Ctrl+Tab literal, igual
  // browser/VS Code — usar `metaKey` aqui só criaria um atalho morto.
  function handleCycleTab(direction: 1 | -1): void {
    const { tabs } = tabsState;
    if (tabs.length < 2) return;
    const currentIndex = tabs.findIndex((tab) => tab.id === tabsState.activeTabId);
    const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
    tabsState.setActiveTab(tabs[nextIndex].id);
  }

  // Atalhos padrão de qualquer app (equivalentes em Ctrl no Windows/Linux e
  // Cmd no macOS, via metaKey || ctrlKey): novo (N), fechar aba atual (W),
  // mostrar/esconder painel lateral (B).
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.ctrlKey && event.key === "Tab") {
        event.preventDefault();
        handleCycleTab(event.shiftKey ? -1 : 1);
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
    activeTabId,
    isCompact,
    tabsState.closeTab,
    tabsState.openTab,
    tabsState.setActiveTab,
    resizable.toggleCollapsed,
  ]);

  // Sessões "rodando" só do perfil selecionado na sidebar agora — é o
  // universo que a lista da sidebar mostra (docs/29: abas em si não têm mais
  // noção de perfil selecionado, só a sidebar tem).
  const runningSessions = new Set(
    tabsState.tabs.filter((tab) => tab.profileId === activeProfile.id && tab.isRunning).map((tab) => tab.id),
  );

  const sidebarProps = {
    activeProfile,
    onProfileChange: handleProfileChange,
    sessions,
    sessionsLoading,
    selectedSession: activeTabId,
    runningSessions,
    onSelectSession: handleSelectSession,
    onNewConversation: handleNewConversation,
    onRenameSession: handleRenameSession,
    onDeleteSession: (id: string) => handleDeleteSession(activeProfile.id, id),
  };

  const activeTab = tabsState.tabs.find((tab) => tab.id === activeTabId);

  // Uma aba pode ser de qualquer perfil (docs/29) — o `ChatPanel` de cada
  // uma usa o perfil gravado na própria aba, não o perfil selecionado na
  // sidebar agora.
  const renderPanel = (tab: Tab) => {
    const profile = findProfile(tab.profileId) ?? PROFILES[0];
    return (
      <ChatPanel
        // No iOS (sem TabBar/forceMount), `activeTab && renderPanel(activeTab)`
        // é um único slot de JSX cujo `sessionId` só muda de valor — sem
        // `key` amarrada à sessão, o React reaproveita a mesma instância
        // ao trocar de conversa (só atualiza props), e o estado interno
        // (useMessageLog etc.) não reseta sozinho. `onReconnecting` não
        // ajuda aqui: ele só dispara numa reconexão de verdade da MESMA
        // instância de RelayClient, não quando useRelayClient troca de
        // sessionId e cria uma instância nova. Resultado era o bug real:
        // clicar em "+" abria uma sessão nova de verdade (conectava,
        // "Reconectando"→"Conectado") mas a tela continuava mostrando o
        // log da conversa anterior. No desktop isso já não acontecia (TabBar
        // já tem `key={tab.id}` no TabsContent, cada aba com instância
        // própria) — aqui é só deixar explícito no mesmo lugar.
        key={tab.id}
        profile={profile}
        sessionId={tab.id}
        isNewConversation={tab.isNew}
        onTurnActiveChange={(active) => tabsState.setRunning(tab.id, active)}
        onTurnComplete={() => {
          const stillVisible = tab.id === tabsState.activeTabId && windowFocused;
          if (!stillVisible) {
            tabsState.setUnread(tab.id, true);
            notifyTurnComplete(profile, tab.title ?? "Nova sessão");
          }
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
          if (tab.profileId === activeProfile.id) removeSession(tab.id);
        }}
        onConnectedChange={(connected) => {
          if (tab.id === tabsState.activeTabId) setActiveConnected(connected);
        }}
      />
    );
  };

  // Compartilhado entre o shell desktop e o iOS — o que muda entre os dois é
  // só o chrome ao redor (TitleBar+Sidebar vs. MobileShell), não como cada
  // sessão é montada.
  //
  // `relative` aqui embaixo não é sobre layout — sem isso, o `backdrop-filter`
  // da MobileTopBar/composer do iOS não sampleia o log de mensagens no
  // WebKit real (bug real, reproduzido via Playwright WebKit — docs/24).
  // Qualquer div `position: static` nessa cadeia até `.mobile-canvas` quebra
  // o blur. Não remover mesmo parecendo redundante — inofensivo pro desktop
  // (não muda posição/tamanho de nada).
  const tabsContent = (
    <div className="relative min-h-0 flex-1">
      {tabsState.tabs.length === 0 ? (
        <EmptyState />
      ) : isIOS() ? (
        // iOS (docs/23, Fase B): MVP é uma sessão em foco por vez, sem manter
        // várias conexões WebSocket vivas em paralelo em segundo plano — só
        // monta a sessão ativa, sem o mecanismo de abas do TabBar
        // (forceMount/dnd-kit, pensado pra desktop).
        activeTab && renderPanel(activeTab)
      ) : (
        <TabBar
          tabs={tabsState.tabs}
          activeTabId={activeTabId}
          onSelect={tabsState.setActiveTab}
          onClose={tabsState.closeTab}
          onReorder={tabsState.reorderTabs}
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
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
        <SessionSearch open={searchOpen} onOpenChange={setSearchOpen} onSelectSession={handleSearchSelectSession} />
        <MobileShell
          activeProfile={activeProfile}
          onProfileChange={handleProfileChange}
          sessions={sessions}
          sessionsLoading={sessionsLoading}
          selectedSession={activeTabId}
          runningSessions={runningSessions}
          onSelectSession={handleSelectSession}
          onRenameSession={handleRenameSession}
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
      />

      <SessionSearch open={searchOpen} onOpenChange={setSearchOpen} onSelectSession={handleSearchSelectSession} />

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
