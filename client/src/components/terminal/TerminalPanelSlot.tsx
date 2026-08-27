import { lazy, Suspense } from "react";
import { usePanelDrag } from "@/hooks/usePanelDrag";
import type { SessionPanelState } from "@/hooks/useSessionPanels";
import type { useTerminalTabs } from "@/hooks/useTerminalTabs";
import type { Profile } from "@/lib/profiles";
import { cn } from "@/lib/utils";

// xterm.js (+ addons) só entra no bundle se/quando o usuário de fato abrir um
// terminal — o `lazy` mora aqui, não no conteúdo pesado em si nem em App.tsx,
// porque o wrapper abaixo (`TerminalPanelSlot`) precisa existir e animar
// ANTES do chunk pesado ter carregado (o fallback do Suspense também vive
// dentro do espaço já animado).
const TerminalPanel = lazy(() =>
  import("@/components/terminal/TerminalPanel").then((mod) => ({ default: mod.TerminalPanel })),
);

interface TerminalPanelSlotProps {
  profile: Profile;
  chatSessionId: string;
  panel: SessionPanelState;
  terminalTabs: ReturnType<typeof useTerminalTabs>;
  onWidthChange: (width: number) => void;
  onToggleMaximized: () => void;
  onClose: () => void;
}

/**
 * Wrapper leve (sem import de xterm.js) montado o tempo todo enquanto a aba
 * de chat está ativa — mesmo com o painel fechado. É isso que dá a mesma
 * animação de abrir/fechar que a sidebar esquerda já tem
 * (`useResizableSidebar`/App.tsx): lá o wrapper nunca desmonta, só a largura
 * muda (0 colapsado, `width` aberto) com transição CSS; aqui era diferente
 * antes — o conteúdo do painel só existia no DOM quando aberto, então não
 * tinha o que a transição animasse (aparecia/sumia de uma vez). Agora o
 * conteúdo pesado (`TerminalPanel`, lazy) só monta quando `panel.open`, mas
 * a largura de quem o hospeda já está animando desde antes — code splitting
 * continua intacto, xterm.js só carrega no primeiro open de verdade.
 */
export function TerminalPanelSlot({
  profile,
  chatSessionId,
  panel,
  terminalTabs,
  onWidthChange,
  onToggleMaximized,
  onClose,
}: TerminalPanelSlotProps) {
  const { isDragging, startDrag } = usePanelDrag(panel.width, onWidthChange);
  const maximizedOpen = panel.open && panel.maximized;

  return (
    <div
      className={cn("h-full shrink-0 overflow-hidden", maximizedOpen && "flex-1")}
      style={{
        width: panel.open ? (panel.maximized ? undefined : panel.width) : 0,
        transition: isDragging ? "none" : "width 150ms ease",
      }}
    >
      {panel.open && (
        <Suspense fallback={<div className="h-full border-l border-border-soft bg-bg-sidebar" style={{ width: panel.maximized ? "100%" : panel.width }} />}>
          <TerminalPanel
            profile={profile}
            chatSessionId={chatSessionId}
            panel={panel}
            terminalTabs={terminalTabs}
            onStartDrag={startDrag}
            onToggleMaximized={onToggleMaximized}
            onClose={onClose}
          />
        </Suspense>
      )}
    </div>
  );
}
