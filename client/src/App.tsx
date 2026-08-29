import { useEffect, useMemo, useRef, useState } from "react";
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
import { TerminalPanelSlot } from "@/components/terminal/TerminalPanelSlot";
import { useActiveProfile } from "@/hooks/useActiveProfile";
import { useNavigationHistory } from "@/hooks/useNavigationHistory";
import { useSessionNames } from "@/hooks/useSessionNames";
import { useResizableSidebar } from "@/hooks/useResizableSidebar";
import { useIsCompactViewport } from "@/hooks/useIsCompactViewport";
import { useTabs, type Tab } from "@/hooks/useTabs";
import { useSessionPanels } from "@/hooks/useSessionPanels";
import { useTerminalTabs } from "@/hooks/useTerminalTabs";
import { useWindowFocus } from "@/hooks/useWindowFocus";
import { useNotificationClick } from "@/hooks/useNotificationClick";
import { PROFILES, findProfile } from "@/lib/profiles";
import { ensureNotificationPermission, scheduleTurnCompleteNotification, resolveNotificationSummary } from "@/lib/notifications";
import { deleteSession, renameSession } from "@/lib/relayClient";
import { isIOS } from "@/lib/platform";
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
  const tabsState = useTabs();
  const sessionPanels = useSessionPanels();
  const terminalTabs = useTerminalTabs();
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

  // Refs "ao vivo" pra `isStillHidden` da notificação (lib/notifications.ts):
  // o agendamento guarda essa função por até alguns segundos esperando o
  // resumo assíncrono do relay, então ela precisa ler o estado mais recente
  // no momento do disparo — um closure fechado sobre `windowFocused`/
  // `activeTabId` do render em que o turno terminou ficaria com valor
  // congelado (stale) por todo esse tempo.
  const windowFocusedRef = useRef(windowFocused);
  windowFocusedRef.current = windowFocused;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

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

  /** Troca de perfil (sidebar) + abre/ativa a aba — usado tanto pela busca de
   * sessão (Cmd/Ctrl+K) quanto pelo clique numa notificação (`useNotificationClick`
   * abaixo), os dois casos de "ir direto pra uma sessão que pode não ser do
   * perfil selecionado agora". */
  function focusSession(profileId: string, sessionId: string, title: string | null = null): void {
    setActiveProfileId(profileId);
    tabsState.openTab(profileId, sessionId, title);
  }

  function handleSearchSelectSession(profileId: string, sessionId: string, title: string): void {
    focusSession(profileId, sessionId, title);
  }

  // Clique numa notificação de turno concluído — ver useNotificationClick.ts
  // pra como cada plataforma entrega isso (e a limitação documentada lá:
  // Windows e iOS funcionam, macOS/Linux desktop não tem o hook de clique).
  useNotificationClick(({ sessionId, profileId }) => {
    focusSession(profileId, sessionId);
  });

  /** `profileId` explícito (não sempre `activeProfile`) pelo mesmo motivo do
   * `handleDeleteSession` logo abaixo: também é chamado a partir de uma aba
   * de outro perfil que não o selecionado na sidebar agora (docs/29). */
  function handleRenameSession(profileId: string, id: string, title: string): void {
    const profile = findProfile(profileId);
    if (!profile) return;
    renameSession(profile.host, profile.relayPort, id, title)
      .then(() => {
        tabsState.setTabTitle(id, title);
        if (profileId === activeProfile.id) upsertTitle(id, title);
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
        sessionPanels.removePanel(id);
        terminalTabs.removeSession(id);
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

  // Terminal embutido (docs/30) — desktop only (screenshot/fluxo original é
  // claramente desktop, iOS fica de fora por enquanto, mesmo gate que
  // voz/titlebar já usam — docs/23).
  function handleToggleTerminalPanel(): void {
    if (isCompact || isIOS() || !activeTabId) return;
    sessionPanels.togglePanel(activeTabId, "terminal");
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
  // mostrar/esconder painel lateral (B). Terminal (Ctrl+`) é tratado à
  // parte, ver comentário dentro do handler.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.ctrlKey && event.key === "Tab") {
        event.preventDefault();
        handleCycleTab(event.shiftKey ? -1 : 1);
        return;
      }
      // `Ctrl+\`` — literal Ctrl mesmo no macOS, nunca `metaKey`: é a
      // convenção do próprio VS Code (Cmd+` no macOS já é do sistema,
      // trocar entre janelas do mesmo app), mesmo motivo do `Ctrl+Tab`
      // acima. Fica fora do switch de baixo de propósito, que é só
      // `metaKey || ctrlKey`.
      if (event.ctrlKey && event.key === "`") {
        event.preventDefault();
        handleToggleTerminalPanel();
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
    sessionPanels.togglePanel,
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
  // Mesmo raciocínio de `runningSessions` — só cobre sessões abertas como
  // aba (docs/32, Fase E): uma sessão sem aba não tem conexão WS viva pra
  // saber se tem job rodando, mesma limitação que `isRunning` já tinha.
  const backgroundJobSessions = new Set(
    tabsState.tabs.filter((tab) => tab.profileId === activeProfile.id && tab.hasBackgroundJob).map((tab) => tab.id),
  );

  const sidebarProps = {
    activeProfile,
    onProfileChange: handleProfileChange,
    sessions,
    sessionsLoading,
    selectedSession: activeTabId,
    runningSessions,
    backgroundJobSessions,
    onSelectSession: handleSelectSession,
    onNewConversation: handleNewConversation,
    onRenameSession: (id: string, title: string) => handleRenameSession(activeProfile.id, id, title),
    onDeleteSession: (id: string) => handleDeleteSession(activeProfile.id, id),
  };

  const activeTab = tabsState.tabs.find((tab) => tab.id === activeTabId);

  // Uma aba pode ser de qualquer perfil (docs/29) — o `ChatPanel` de cada
  // uma usa o perfil gravado na própria aba, não o perfil selecionado na
  // sidebar agora.
  const renderPanel = (tab: Tab) => {
    const profile = findProfile(tab.profileId) ?? PROFILES[0];
    const panel = sessionPanels.getPanel(tab.id);
    const chatContent = (
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
        onBackgroundJobsChange={(jobs) => tabsState.setHasBackgroundJob(tab.id, jobs.length > 0)}
        onTurnComplete={({ stopped, lastUserText }) => {
          const stillVisible = tab.id === tabsState.activeTabId && windowFocused;
          if (stillVisible) return;
          tabsState.setUnread(tab.id, true);
          const isStillHidden = () => !(tab.id === activeTabIdRef.current && windowFocusedRef.current);
          scheduleTurnCompleteNotification(
            tab.id,
            profile,
            tab.title ?? "Nova sessão",
            lastUserText,
            stopped,
            isStillHidden,
          );
        }}
        onNotificationSummary={(summary) => resolveNotificationSummary(tab.id, summary)}
        onTitle={(title) => {
          tabsState.setTabTitle(tab.id, title);
          if (tab.profileId === activeProfile.id) upsertTitle(tab.id, title);
        }}
        onActivity={() => {
          if (tab.profileId === activeProfile.id) touch(tab.id);
        }}
        onDeleted={() => {
          tabsState.closeTab(tab.id);
          sessionPanels.removePanel(tab.id);
          terminalTabs.removeSession(tab.id);
          if (tab.profileId === activeProfile.id) removeSession(tab.id);
        }}
        onConnectedChange={(connected) => {
          if (tab.id === tabsState.activeTabId) setActiveConnected(connected);
        }}
        terminal={
          isCompact || isIOS()
            ? undefined
            : { open: panel.open, onToggle: () => sessionPanels.togglePanel(tab.id, "terminal") }
        }
      />
    );

    if (isCompact || isIOS()) return chatContent;

    // Terminal embutido (docs/30), desktop only. `isTabActive` é o que
    // implementa "trocar de sessão fecha o painel sozinho, voltar reabre do
    // jeito que estava": `TabBar` mantém TODAS as abas montadas em segundo
    // plano (forceMount, pra manter a WS do chat viva — ver comentário mais
    // abaixo), então sem esse gate o painel de terminal ficaria conectado
    // pra sessões fora de foco também. Só a aba ativa realmente monta
    // `TerminalPanelSlot`; as outras nem chegam a existir no DOM, então nem
    // abrem WS nenhuma pro terminal — o custo de várias abas de chat
    // abertas ao mesmo tempo (vários perfis, vários contextos) fica restrito
    // a um único painel de terminal vivo por vez, não um por sessão.
    //
    // Diferente de antes, o gate aqui não inclui mais `panel.open` — é
    // assim que a animação de abrir/fechar (mesma da sidebar esquerda,
    // useResizableSidebar) funciona: `TerminalPanelSlot` fica montado o
    // tempo todo enquanto a aba está ativa, e é ELE (por dentro, leve, sem
    // xterm.js) quem decide a largura (0 fechado, animando pra `panel.width`
    // aberto). Sem isso o conteúdo do painel só existia no DOM quando aberto
    // — não tinha o que a transição CSS animasse, aparecia/sumia de vez.
    const isTabActive = tab.id === activeTabId;
    const chatHidden = isTabActive && panel.open && panel.maximized;

    // O wrapper (esta `div` + a `div` logo abaixo em volta de `chatContent`)
    // é renderizado incondicionalmente, com a MESMA forma sempre — só a
    // presença do `TerminalPanelSlot` como irmão alterna (junto com a aba
    // ficando ativa/inativa). Antes disso era condicional (`if
    // (!showTerminal) return chatContent` sem wrapper nenhum), e abrir/
    // fechar/trocar de aba de terminal trocava o tipo do filho nessa posição
    // da árvore (de `ChatPanel` direto pra `div`) — o React via isso como um
    // elemento diferente e desmontava `ChatPanel` inteiro (perdendo `ready`,
    // fechando a WS, reconectando), que é exatamente o flash de skeleton
    // reportado ao abrir/expandir/fechar o painel. Manter a forma estável
    // evita esse remount.
    return (
      <div className="relative flex h-full min-w-0">
        {/* `invisible absolute inset-0` em vez de encolher pra 0 — mesmo
         * truque (e mesmo motivo) do `forceMount` de `TabBar.tsx`: o
         * `MessageLog` usa `@tanstack/react-virtual`, cujo `ResizeObserver`
         * corrompe o cache de alturas se o container medir tamanho 0 mesmo
         * que só brevemente (é exatamente o que aconteceria maximizando o
         * terminal se o chat fosse escondido via `display:none`/largura 0). */}
        <div className={cn("min-w-0 flex-1", chatHidden && "invisible absolute inset-0")}>{chatContent}</div>
        {isTabActive && (
          <TerminalPanelSlot
            profile={profile}
            chatSessionId={tab.id}
            panel={panel}
            terminalTabs={terminalTabs}
            onWidthChange={(width) => sessionPanels.setWidth(tab.id, width)}
            onToggleMaximized={() => sessionPanels.toggleMaximized(tab.id)}
            onClose={() => sessionPanels.closePanel(tab.id)}
          />
        )}
      </div>
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
          onRenameSession={(tabId, title) => {
            const tab = tabsState.tabs.find((t) => t.id === tabId);
            if (tab) handleRenameSession(tab.profileId, tabId, title);
          }}
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
          backgroundJobSessions={backgroundJobSessions}
          onSelectSession={handleSelectSession}
          onRenameSession={(id, title) => handleRenameSession(activeProfile.id, id, title)}
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
