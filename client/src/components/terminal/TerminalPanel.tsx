import { useEffect, useRef } from "react";
import { SessionPanel } from "@/components/shell/SessionPanel";
import { TerminalTabStrip } from "@/components/terminal/TerminalTabStrip";
import { TerminalView } from "@/components/terminal/TerminalView";
import type { SessionPanelState } from "@/hooks/useSessionPanels";
import type { useTerminalTabs } from "@/hooks/useTerminalTabs";
import { closeTerminal } from "@/lib/relayClient";
import type { Profile } from "@/lib/profiles";

interface TerminalPanelProps {
  profile: Profile;
  chatSessionId: string;
  panel: SessionPanelState;
  terminalTabs: ReturnType<typeof useTerminalTabs>;
  /** Handler de arraste — o estado de largura em si (`isDragging` incluso)
   * mora em `TerminalPanelSlot` agora, não aqui: precisa ficar visível pro
   * wrapper animado que fica montado mesmo com o painel fechado (ver
   * TerminalPanelSlot.tsx). */
  onStartDrag: (event: React.PointerEvent) => void;
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
export function TerminalPanel({
  profile,
  chatSessionId,
  panel,
  terminalTabs,
  onStartDrag,
  onToggleMaximized,
  onClose,
}: TerminalPanelProps) {
  const { tabs, activeTerminalId } = terminalTabs.getTabs(chatSessionId);
  const { addTerminal } = terminalTabs;
  /** `true` assim que a lista já teve pelo menos uma aba — é o que distingue
   * "painel recém-aberto, ainda vazio" (semeia "Terminal 1") de "tinha aba,
   * usuário fechou a última" (fecha o painel). Um único efeito, não dois:
   * a primeira versão disparava os dois em sequência na mesma passada —
   * `addTerminal` já marca uma flag síncrona antes do estado novo (`tabs`)
   * ter re-renderizado, então um efeito de "fechar se vazio" separado lia
   * `tabs.length` ainda como 0 e fechava o painel um instante depois de
   * abrir (achado testando de verdade: abrir sempre voltava a fechar
   * sozinho). Um efeito só, guiado pela transição real de `tabs.length`
   * entre renders, evita a corrida. */
  const hasHadTabsRef = useRef(false);
  useEffect(() => {
    if (tabs.length > 0) {
      hasHadTabsRef.current = true;
      return;
    }
    if (hasHadTabsRef.current) {
      onClose();
    } else {
      addTerminal(chatSessionId);
    }
  }, [tabs.length, chatSessionId, onClose, addTerminal]);

  function handleCloseTerminal(terminalId: string): void {
    terminalTabs.closeTerminal(chatSessionId, terminalId);
    closeTerminal(profile.host, profile.relayPort, chatSessionId, terminalId).catch((error: unknown) => {
      console.error("[ultron] falha ao fechar terminal:", error);
    });
  }

  return (
    <SessionPanel
      maximized={panel.maximized}
      onStartDrag={onStartDrag}
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
