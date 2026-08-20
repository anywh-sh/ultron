import { useEffect, useMemo, useState } from "react";
import { Menu, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Sidebar } from "@/components/shell/Sidebar";
import { EmptyState } from "@/components/shell/EmptyState";
import { TabBar } from "@/components/shell/TabBar";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { useActiveProfile } from "@/hooks/useActiveProfile";
import { useSessionNames } from "@/hooks/useSessionNames";
import { useResizableSidebar } from "@/hooks/useResizableSidebar";
import { useIsCompactViewport } from "@/hooks/useIsCompactViewport";
import { useProfileTabs } from "@/hooks/useProfileTabs";
import { PROFILES, findProfile } from "@/lib/profiles";
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
  const { sessions, loading: sessionsLoading } = useSessionNames(activeProfile);
  const isCompact = useIsCompactViewport();
  const resizable = useResizableSidebar();
  const profileTabs = useProfileTabs();

  const [emptyVariant, setEmptyVariant] = useState<"new" | "switch">("switch");
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Primeiro lançamento (ou primeira vez visitando um perfil nesta sessão do
  // app): restaura a última sessão usada — docs/18. Só roda quando o perfil
  // ativo ainda não tem nenhuma aba aberta.
  useEffect(() => {
    if (profileTabs.getTabs(activeProfile.id).tabs.length > 0) return;
    const sessionToOpen = queryOverride.session ?? profileTabs.getLastSession(activeProfile.id);
    if (sessionToOpen) profileTabs.openTab(activeProfile.id, sessionToOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfile.id]);

  // Limpa o badge de "turno concluído" da aba que está visível agora.
  const activeTabIdOfActiveProfile = profileTabs.getTabs(activeProfile.id).activeTabId;
  useEffect(() => {
    if (activeTabIdOfActiveProfile) profileTabs.setUnread(activeProfile.id, activeTabIdOfActiveProfile, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfile.id, activeTabIdOfActiveProfile]);

  function handleProfileChange(profileId: string): void {
    setActiveProfileId(profileId);
    setEmptyVariant("switch");
    setDrawerOpen(false);
  }

  function handleNewConversation(): void {
    const { tabs } = profileTabs.getTabs(activeProfile.id);
    if (tabs.length === 0) {
      setEmptyVariant("new");
    } else {
      const name = window.prompt("Nome da nova sessão:")?.trim();
      if (name) profileTabs.openTab(activeProfile.id, name);
    }
    setDrawerOpen(false);
  }

  function handleSelectSession(name: string): void {
    profileTabs.openTab(activeProfile.id, name);
    setDrawerOpen(false);
  }

  const sidebarProps = {
    activeProfile,
    onProfileChange: handleProfileChange,
    sessions,
    sessionsLoading,
    selectedSession: activeTabIdOfActiveProfile,
    onSelectSession: handleSelectSession,
    onNewConversation: handleNewConversation,
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {!isCompact && (
        <div
          className="relative flex shrink-0 border-r border-border-soft"
          style={{
            width: resizable.width,
            transition: resizable.isDragging ? "none" : "width 150ms ease",
          }}
        >
          <div className="min-w-0 flex-1 overflow-hidden">
            {!resizable.collapsed && <Sidebar {...sidebarProps} onCollapse={resizable.toggleCollapsed} />}
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
        <div className="flex items-center gap-2 p-2">
          {isCompact && (
            <Button variant="ghost" size="icon" onClick={() => setDrawerOpen(true)} aria-label="Abrir barra lateral">
              <Menu className="size-4" />
            </Button>
          )}
          {!isCompact && resizable.collapsed && (
            <Button variant="ghost" size="icon" onClick={resizable.toggleCollapsed} aria-label="Expandir barra lateral">
              <PanelLeftOpen className="size-4" />
            </Button>
          )}
        </div>

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
                    onSelect={(tabId) => profileTabs.setActiveTab(profile.id, tabId)}
                    onClose={(tabId) => profileTabs.closeTab(profile.id, tabId)}
                    renderPanel={(tab) => (
                      <ChatPanel
                        profile={findProfile(profile.id) ?? profile}
                        sessionName={tab.sessionName}
                        onTurnComplete={() => {
                          const stillVisible =
                            profile.id === activeProfile.id &&
                            tab.id === profileTabs.getTabs(profile.id).activeTabId;
                          if (!stillVisible) profileTabs.setUnread(profile.id, tab.id, true);
                        }}
                      />
                    )}
                  />
                ) : (
                  isActiveProfile && (
                    <EmptyState
                      variant={emptyVariant}
                      onCreateSession={(name) => profileTabs.openTab(profile.id, name)}
                    />
                  )
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
