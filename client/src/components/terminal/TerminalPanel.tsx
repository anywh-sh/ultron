import { useEffect, useRef } from "react";
import { SessionPanel } from "@/components/shell/SessionPanel";
import { TerminalTabStrip } from "@/components/terminal/TerminalTabStrip";
import { TerminalView } from "@/components/terminal/TerminalView";
import { usePanelDrag } from "@/hooks/usePanelDrag";
import type { SessionPanelState } from "@/hooks/useSessionPanels";
import type { useTerminalTabs } from "@/hooks/useTerminalTabs";
import { closeTerminal } from "@/lib/relayClient";
import type { Profile } from "@/lib/profiles";

interface TerminalPanelProps {
  profile: Profile;
  chatSessionId: string;
  panel: SessionPanelState;
  terminalTabs: ReturnType<typeof useTerminalTabs>;
  onWidthChange: (width: number) => void;
  onToggleMaximized: () => void;
  onClose: () => void;
}

/**
 * Conteúdo específico de terminal, plugado na casca genérica `SessionPanel`.
 * Só monta enquanto a aba de chat dona dele está ativa E o painel está
 * marcado como aberto (decidido por quem chama, ver App.tsx) — é essa
 * montagem/desmontagem condicional que implementa "trocar de sessão fecha o
 * painel sozinho, voltar reabre do jeito que estava": desmontar fecha a WS
 * de cada aba de terminal (o relay só detacha do tmux, nunca mata a sessão
 * por causa disso — ver terminalSession.ts), remontar reconecta e o tmux
 * redesenha a tela sozinho.
 *
 * Todas as abas de terminal do painel ficam montadas ao mesmo tempo
 * (`forceMount`, mesmo truque de `TabBar.tsx`) — só o painel inteiro
 * conecta/desconecta ao entrar/sair de foco, trocar entre abas de terminal
 * dentro de um painel já aberto é instantâneo, sem reconectar. O número de
 * abas por painel tende a ser pequeno (poucas unidades), então o custo de
 * mantê-las todas vivas é baixo — bem diferente de manter viva a de
 * *todas* as sessões de chat, que é justamente o que a montagem
 * condicional acima evita.
 */
export function TerminalPanel({ profile, chatSessionId, panel, terminalTabs, onWidthChange, onToggleMaximized, onClose }: TerminalPanelProps) {
  const { isDragging, startDrag } = usePanelDrag(panel.width, onWidthChange);
  const { tabs, activeTerminalId } = terminalTabs.getTabs(chatSessionId);
  const initializedRef = useRef(false);

  // Painel recém-aberto sem nenhuma aba ainda (primeira vez que essa sessão
  // abre o terminal) — cria "Terminal 1" sozinho, sem exigir um clique extra
  // no "+". `initializedRef` evita recriar depois que o usuário fechou a
  // última aba de propósito (ver efeito de auto-close logo abaixo).
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    if (tabs.length === 0) terminalTabs.addTerminal(chatSessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatSessionId]);

  // Fechou a última aba de terminal → não faz sentido manter o painel
  // aberto mostrando nada. Só depois da inicialização acima, senão fecharia
  // o painel na primeira renderização (antes do "Terminal 1" existir).
  useEffect(() => {
    if (initializedRef.current && tabs.length === 0) onClose();
  }, [tabs.length, onClose]);

  function handleCloseTerminal(terminalId: string): void {
    terminalTabs.closeTerminal(chatSessionId, terminalId);
    closeTerminal(profile.host, profile.relayPort, chatSessionId, terminalId).catch((error: unknown) => {
      console.error("[ultron] falha ao fechar terminal:", error);
    });
  }

  return (
    <SessionPanel
      width={panel.width}
      isDragging={isDragging}
      maximized={panel.maximized}
      onStartDrag={startDrag}
      onToggleMaximized={onToggleMaximized}
      onClose={onClose}
      headerExtra={
        <TerminalTabStrip
          tabs={tabs}
          activeTerminalId={activeTerminalId}
          onSelect={(id) => terminalTabs.setActiveTerminal(chatSessionId, id)}
          onClose={handleCloseTerminal}
          onAdd={() => terminalTabs.addTerminal(chatSessionId)}
        />
      }
    >
      <div className="relative h-full min-h-0">
        {tabs.map((tab) => (
          <div key={tab.id} className={tab.id === activeTerminalId ? "absolute inset-0" : "invisible absolute inset-0"}>
            <TerminalView profile={profile} chatSessionId={chatSessionId} terminalId={tab.id} />
          </div>
        ))}
      </div>
    </SessionPanel>
  );
}
