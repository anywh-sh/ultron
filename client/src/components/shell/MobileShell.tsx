import type { CSSProperties, ReactNode } from "react";
import { MobileSidebar } from "@/components/shell/MobileSidebar";
import { MobileTopBar } from "@/components/shell/MobileTopBar";
import { REVEAL_PUSH_PX, useRevealDrawer } from "@/hooks/useRevealDrawer";
import { cn } from "@/lib/utils";
import type { Profile } from "@/lib/profiles";
import type { SessionSummary } from "@/lib/relay-types";

interface MobileShellProps {
  activeProfile: Profile;
  onProfileChange: (profileId: string) => void;
  sessions: SessionSummary[];
  sessionsLoading: boolean;
  selectedSession: string | null;
  runningSessions: Set<string>;
  backgroundJobSessions: Set<string>;
  onSelectSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onDeleteSession: (id: string) => void;
  onOpenSearch: () => void;
  title: string;
  connected: boolean;
  onNewConversation: () => void;
  children: ReactNode;
}

/**
 * Shell do app no iOS (docs/24) — substitui o chrome do desktop (TitleBar +
 * Sidebar resizable/Sheet) por: sidebar de sessões sempre montada atrás
 * (`MobileSidebar`), e um "canvas" na frente que carrega a barra superior
 * consolidada (`MobileTopBar`) + o conteúdo do chat (`children`, o mesmo
 * `PROFILES.map` que o `App` já monta pro desktop). O canvas desliza pra
 * revelar a sidebar em vez de um overlay com scrim — ver `useRevealDrawer`.
 */
export function MobileShell({
  activeProfile,
  onProfileChange,
  sessions,
  sessionsLoading,
  selectedSession,
  runningSessions,
  backgroundJobSessions,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onOpenSearch,
  title,
  connected,
  onNewConversation,
  children,
}: MobileShellProps) {
  const drawer = useRevealDrawer();

  return (
    <div
      className="relative min-h-0 flex-1 overflow-hidden bg-bg-sidebar"
      style={{ "--push": `${REVEAL_PUSH_PX}px` } as CSSProperties}
    >
      <MobileSidebar
        activeProfile={activeProfile}
        onProfileChange={(profileId) => {
          onProfileChange(profileId);
          drawer.closeDrawer();
        }}
        sessions={sessions}
        sessionsLoading={sessionsLoading}
        selectedSession={selectedSession}
        runningSessions={runningSessions}
        backgroundJobSessions={backgroundJobSessions}
        onSelectSession={(id) => {
          onSelectSession(id);
          drawer.closeDrawer();
        }}
        onRenameSession={onRenameSession}
        onDeleteSession={onDeleteSession}
        onOpenSearch={() => {
          onOpenSearch();
          drawer.closeDrawer();
        }}
      />

      <div
        ref={drawer.canvasRef}
        onPointerDown={drawer.onCanvasPointerDown}
        className={cn("mobile-canvas absolute inset-0 z-10 overflow-hidden bg-background", drawer.open && "pushed")}
      >
        {/* `display:contents` — só existe pra carregar `inert`, sem afetar o
         * posicionamento absoluto da MobileTopBar por baixo. Com o drawer
         * aberto, a tela principal inteira (barra + chat) fica de verdade
         * fora de alcance — sem scroll, sem foco, sem clique — até o toque
         * no bloqueador abaixo devolver o foco (equivalente a arrastar de
         * volta pra esquerda). */}
        <div inert={drawer.open} className="contents">
          <MobileTopBar
            title={title}
            connected={connected}
            onOpenDrawer={drawer.toggleDrawer}
            onNewConversation={onNewConversation}
          />

          {/* Sem padding-top aqui de propósito: o log de mensagens precisa
           * poder rolar por baixo da zona de blur da MobileTopBar (fica
           * visível-só-que-desfocado, docs/24) — o respiro pro conteúdo não
           * ficar colado embaixo dos botões vem de dentro do MessageLog
           * (ChatPanel passa `pt-[...]` só pro log), não empurrando a coluna
           * inteira pra baixo. `relative` é o fix do bug de backdrop-filter
           * do WebKit (ver comentário em MessageLog.tsx) — não remover. */}
          <div className="relative flex h-full flex-col">{children}</div>
        </div>

        <div
          onPointerDown={drawer.onBlockerPointerDown}
          onClick={drawer.closeDrawer}
          className={cn("absolute inset-0 z-[39]", drawer.open ? "pointer-events-auto cursor-pointer" : "pointer-events-none")}
        />
      </div>
    </div>
  );
}
