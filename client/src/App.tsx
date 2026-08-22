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
import { ChatPanel } from "@/components/chat/ChatPanel";
import { useActiveProfile } from "@/hooks/useActiveProfile";
import { useNavigationHistory } from "@/hooks/useNavigationHistory";
import { useSessionNames } from "@/hooks/useSessionNames";
import { useResizableSidebar } from "@/hooks/useResizableSidebar";
import { useIsCompactViewport } from "@/hooks/useIsCompactViewport";
import { useProfileTabs } from "@/hooks/useProfileTabs";
import { useWindowFocus } from "@/hooks/useWindowFocus";
import { PROFILES, findProfile } from "@/lib/profiles";
import { ensureNotificationPermission, notifyTurnComplete } from "@/lib/notifications";
import { deleteSession, renameSession } from "@/lib/relayClient";
import { cn } from "@/lib/utils";

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
  const profileTabs = useProfileTabs();
  const nav = useNavigationHistory();
  const windowFocused = useWindowFocus();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

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

  // Primeiro lançamento (ou primeira vez visitando um perfil nesta sessão do
  // app): restaura as abas da última vez (lista completa + ordem + qual
  // estava ativa). Só roda quando o perfil ativo ainda não tem nenhuma aba
  // aberta. Deep-link de teste via query string (docs/13) tem prioridade e
  // continua abrindo só a sessão pedida.
  useEffect(() => {
    if (profileTabs.getTabs(activeProfile.id).tabs.length > 0) return;
    if (queryOverride.session) {
      profileTabs.openTab(activeProfile.id, queryOverride.session);
      return;
    }
    const persisted = profileTabs.getPersistedTabs(activeProfile.id);
    if (persisted) profileTabs.restoreTabs(activeProfile.id, persisted.tabs, persisted.activeTabId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfile.id]);

  // Limpa o badge de "turno concluído" da aba que está visível agora.
  const activeTabIdOfActiveProfile = profileTabs.getTabs(activeProfile.id).activeTabId;
  useEffect(() => {
    if (activeTabIdOfActiveProfile) profileTabs.setUnread(activeProfile.id, activeTabIdOfActiveProfile, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfile.id, activeTabIdOfActiveProfile]);

  // Empilha uma entrada de histórico (Back/Forward da titlebar — docs/21)
  // toda vez que o perfil ou a aba ativa mudam, exceto quando a mudança veio
  // do próprio goBack/goForward (o hook filtra isso internamente).
  useEffect(() => {
    nav.notifyLocationChanged({ profileId: activeProfile.id, tabId: activeTabIdOfActiveProfile });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfile.id, activeTabIdOfActiveProfile]);

  function handleGoBack(): void {
    const location = nav.goBack();
    if (!location) return;
    setActiveProfileId(location.profileId);
    if (location.tabId) profileTabs.setActiveTab(location.profileId, location.tabId);
  }

  function handleGoForward(): void {
    const location = nav.goForward();
    if (!location) return;
    setActiveProfileId(location.profileId);
    if (location.tabId) profileTabs.setActiveTab(location.profileId, location.tabId);
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
    profileTabs.openTab(activeProfile.id, id, null, true);
    setDrawerOpen(false);
  }

  function handleSelectSession(id: string): void {
    const title = sessions.find((session) => session.id === id)?.title ?? null;
    profileTabs.openTab(activeProfile.id, id, title);
    setDrawerOpen(false);
  }

  function handleSearchSelectSession(profileId: string, sessionId: string, title: string): void {
    setActiveProfileId(profileId);
    profileTabs.openTab(profileId, sessionId, title);
  }

  function handleRenameSession(id: string, title: string): void {
    renameSession(activeProfile.host, activeProfile.relayPort, id, title)
      .then(() => {
        upsertTitle(id, title);
        profileTabs.setTabTitle(activeProfile.id, id, title);
      })
      .catch((error: unknown) => {
        console.error("[ultron] falha ao renomear sessão", error);
        window.alert("Não foi possível renomear a sessão.");
      });
  }

  /** Só tira a sessão do controle do ultron — não apaga o transcript que o
   * Claude Code já mantém sozinho. `profileId` explícito (não sempre
   * `activeProfile`) porque também é chamado a partir da TabBar de um perfil
   * em segundo plano (abas continuam montadas trocando de perfil, docs/18). */
  function handleDeleteSession(profileId: string, id: string): void {
    const profile = findProfile(profileId);
    if (!profile) return;
    deleteSession(profile.host, profile.relayPort, id)
      .then(() => {
        profileTabs.closeTab(profileId, id);
        if (profileId === activeProfile.id) removeSession(id);
      })
      .catch((error: unknown) => {
        console.error("[ultron] falha ao excluir sessão", error);
        window.alert("Não foi possível excluir a sessão.");
      });
  }

  function handleCloseActiveTab(): void {
    if (!activeTabIdOfActiveProfile) return;
    profileTabs.closeTab(activeProfile.id, activeTabIdOfActiveProfile);
  }

  function handleToggleSidebarShortcut(): void {
    if (isCompact) {
      setDrawerOpen((open) => !open);
    } else {
      resizable.toggleCollapsed();
    }
  }

  // Atalhos padrão de qualquer app (equivalentes em Ctrl no Windows/Linux e
  // Cmd no macOS, via metaKey || ctrlKey): novo (N), fechar aba atual (W),
  // mostrar/esconder painel lateral (B).
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
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
  }, [activeProfile.id, activeTabIdOfActiveProfile, isCompact, profileTabs.closeTab, profileTabs.openTab, resizable.toggleCollapsed]);

  const runningSessions = new Set(
    profileTabs
      .getTabs(activeProfile.id)
      .tabs.filter((tab) => tab.isRunning)
      .map((tab) => tab.id),
  );

  const sidebarProps = {
    activeProfile,
    onProfileChange: handleProfileChange,
    sessions,
    sessionsLoading,
    selectedSession: activeTabIdOfActiveProfile,
    runningSessions,
    onSelectSession: handleSelectSession,
    onNewConversation: handleNewConversation,
    onRenameSession: handleRenameSession,
    onDeleteSession: (id: string) => handleDeleteSession(activeProfile.id, id),
  };

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

          <div className="min-h-0 flex-1">
            {PROFILES.map((profile) => {
              const { tabs, activeTabId } = profileTabs.getTabs(profile.id);
              const isActiveProfile = profile.id === activeProfile.id;

              return (
                <div key={profile.id} className={cn("h-full", !isActiveProfile && "hidden")}>
                  {tabs.length > 0 ? (
                    <TabBar
                      tabs={tabs}
                      activeTabId={activeTabId}
                      profileId={profile.id}
                      onSelect={(tabId) => profileTabs.setActiveTab(profile.id, tabId)}
                      onClose={(tabId) => profileTabs.closeTab(profile.id, tabId)}
                      onReorder={(activeTabId, overTabId) => profileTabs.reorderTabs(profile.id, activeTabId, overTabId)}
                      onDelete={(tabId) => handleDeleteSession(profile.id, tabId)}
                      renderPanel={(tab) => (
                        <ChatPanel
                          profile={findProfile(profile.id) ?? profile}
                          sessionId={tab.id}
                          isNewConversation={tab.isNew}
                          onTurnActiveChange={(active) => profileTabs.setRunning(profile.id, tab.id, active)}
                          onTurnComplete={() => {
                            const stillVisible =
                              profile.id === activeProfile.id &&
                              tab.id === profileTabs.getTabs(profile.id).activeTabId &&
                              windowFocused;
                            if (!stillVisible) {
                              profileTabs.setUnread(profile.id, tab.id, true);
                              notifyTurnComplete(findProfile(profile.id) ?? profile, tab.title ?? "Nova conversa");
                            }
                          }}
                          onTitle={(title) => {
                            profileTabs.setTabTitle(profile.id, tab.id, title);
                            if (profile.id === activeProfile.id) upsertTitle(tab.id, title);
                          }}
                          onActivity={() => {
                            if (profile.id === activeProfile.id) touch(tab.id);
                          }}
                          onDeleted={() => {
                            profileTabs.closeTab(profile.id, tab.id);
                            if (profile.id === activeProfile.id) removeSession(tab.id);
                          }}
                        />
                      )}
                    />
                  ) : (
                    isActiveProfile && <EmptyState />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
