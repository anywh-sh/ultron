import { useEffect, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { useRelayClient } from "@/hooks/useRelayClient";
import { useMessageLog } from "@/hooks/useMessageLog";
import { useImageUpload, type PendingImage } from "@/hooks/useImageUpload";
import { MessageLog } from "@/components/chat/MessageLog";
import { MessageLogSkeleton } from "@/components/chat/MessageLogSkeleton";
import { ChatIdleState } from "@/components/chat/ChatIdleState";
import { TurnIndicator } from "@/components/chat/TurnIndicator";
import { Composer, type ComposerHandle } from "@/components/chat/Composer";
import { WorkingDirectoryButton } from "@/components/chat/WorkingDirectoryButton";
import { isIOS } from "@/lib/platform";
import { cn } from "@/lib/utils";
import type { Profile } from "@/lib/profiles";

interface ChatPanelProps {
  profile: Profile;
  sessionId: string;
  /** Aba aberta via "nova conversa" — mostra o estado ocioso em vez do
   * skeleton de carregamento enquanto o log ainda está vazio. */
  isNewConversation?: boolean;
  onTurnComplete?: () => void;
  onTurnActiveChange?: (active: boolean) => void;
  /** Título inferido do primeiro prompt (ou de um rename ao vivo em outro
   * dispositivo) chegando pela WS dessa sessão — ver sharedSession.ts. */
  onTitle?: (title: string) => void;
  /** Mensagem enviada — usado só pra subir a sessão pro topo da sidebar
   * (ordenação por última interação); o relay já persiste isso sozinho
   * (SharedSession.onActivity), esse callback é só a atualização otimista
   * local, sem round-trip. */
  onActivity?: () => void;
  /** Sessão excluída, por este dispositivo ou outro — ver
   * sharedSession.ts::closeAllClients. */
  onDeleted?: () => void;
  /** Estado de conexão desta sessão — `App` usa isso pra alimentar a barra
   * superior consolidada do iOS (docs/24), que vive fora do ChatPanel. */
  onConnectedChange?: (connected: boolean) => void;
}

function buildWireMessage(text: string, images: PendingImage[]): string {
  const imageRefs = images.map((image) => `[imagem anexada: ${image.path}]`).join("\n");
  return [text, imageRefs].filter(Boolean).join("\n\n");
}

export function ChatPanel({
  profile,
  sessionId,
  isNewConversation,
  onTurnComplete,
  onTurnActiveChange,
  onTitle,
  onActivity,
  onDeleted,
  onConnectedChange,
}: ChatPanelProps) {
  const log = useMessageLog();
  const logRef = useRef(log);
  logRef.current = log;
  const onTurnActiveChangeRef = useRef(onTurnActiveChange);
  onTurnActiveChangeRef.current = onTurnActiveChange;
  const onTitleRef = useRef(onTitle);
  onTitleRef.current = onTitle;
  const onDeletedRef = useRef(onDeleted);
  onDeletedRef.current = onDeleted;

  // O relay reenvia o histórico inteiro da sessão a cada conexão nova
  // (`SharedSession.addClient`), inclusive `turn_complete` de turnos
  // antigos — necessário pra reconstruir o log de mensagens ao reabrir uma
  // aba, mas não deve contar como "turno concluído" pra badge/notificação.
  // `caughtUpRef` fica `true` só depois do marcador `caught_up`, que o relay
  // manda logo após o replay — daí em diante os eventos são mesmo ao vivo.
  const caughtUpRef = useRef(false);
  // Mesmo sinal, mas em state — dispara o re-render que troca o skeleton
  // pelo log de verdade. Volta a `false` numa reconexão de verdade
  // (`onReconnecting`, docs/23 Fase D1) — o replay vai chegar de novo do
  // zero, então o skeleton reaparece brevemente em vez de mostrar o log
  // esvaziado sem indicação nenhuma.
  const [ready, setReady] = useState(false);

  const images = useImageUpload(profile, (message) => window.alert(message));
  const composerRef = useRef<ComposerHandle>(null);

  // Contador em vez de um boolean simples: dragenter/dragleave disparam pra
  // cada elemento filho sobrevoado, um simples enter/leave "pisca" o overlay
  // ao passar por cima de itens do log. Só esconde quando o contador zera.
  const dragCounterRef = useRef(0);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Cobre do clique em "Enviar" até o turno terminar (sucesso ou erro) — não
  // só o tempo de resposta do modelo, também a ida/volta de rede, pra nunca
  // dar sensação de travado (feedback do usuário).
  const [turnInFlight, setTurnInFlight] = useState(false);

  // Reporta o estado pro Tab (`isRunning`) via ref — abas em background
  // continuam montadas (docs/18), então isso também cobre turnos rodando
  // fora da aba/perfil visível no momento.
  useEffect(() => {
    onTurnActiveChangeRef.current?.(turnInFlight);
  }, [turnInFlight]);

  const {
    connected,
    cwd,
    cwdLocked,
    permissionMode,
    contextUsage,
    compactBoundary,
    sendMessage,
    stopTurn,
    setCwd,
    setPermissionMode,
  } = useRelayClient(profile, sessionId, {
    onEvent: (event) => logRef.current.handleEvent(event),
    onReconnecting: () => {
      logRef.current.reset();
      caughtUpRef.current = false;
      setReady(false);
    },
    onCaughtUp: () => {
      caughtUpRef.current = true;
      setReady(true);
    },
    onTurnComplete: (stopped) => {
      logRef.current.handleTurnComplete(stopped);
      setTurnInFlight(false);
      if (caughtUpRef.current) onTurnComplete?.();
    },
    onTurnError: (message) => {
      logRef.current.handleTurnError(message);
      setTurnInFlight(false);
    },
    onSetCwdError: (message) => window.alert(`Não foi possível trocar a pasta: ${message}`),
    onSessionTitle: (title) => onTitleRef.current?.(title),
    onSessionDeleted: () => onDeletedRef.current?.(),
  });

  const onConnectedChangeRef = useRef(onConnectedChange);
  onConnectedChangeRef.current = onConnectedChange;
  useEffect(() => {
    onConnectedChangeRef.current?.(connected);
  }, [connected]);

  return (
    <div
      className="relative flex h-full flex-col"
      onDragEnter={(event) => {
        event.preventDefault();
        dragCounterRef.current += 1;
        setIsDraggingOver(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault();
        dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
        if (dragCounterRef.current === 0) setIsDraggingOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragCounterRef.current = 0;
        setIsDraggingOver(false);
        if (event.dataTransfer.files.length > 0) {
          void images.addFiles(event.dataTransfer.files);
          composerRef.current?.focus();
        }
      }}
    >
      {isDraggingOver && (
        <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary bg-background/90 text-sm text-primary">
          <ImagePlus className="size-4" />
          Solte a imagem aqui
        </div>
      )}

      {isNewConversation && log.entries.length === 0 && log.streamingEntries.length === 0 ? (
        <ChatIdleState />
      ) : ready ? (
        <MessageLog
          entries={log.entries}
          streamingEntries={log.streamingEntries}
          className={isIOS() ? "pt-[calc(env(safe-area-inset-top)+64px)] pb-32" : undefined}
        />
      ) : (
        <MessageLogSkeleton />
      )}

      {turnInFlight && <TurnIndicator />}

      {/* iOS (docs/24): cwd + composer flutuam por cima do log, saindo do
       * fluxo normal — o log continua rolando visível (desfocado) por baixo
       * do glass do composer, em vez de parar acima de um bloco fixo. */}
      <div
        className={cn(
          isIOS()
            ? "absolute inset-x-0 bottom-0 z-20 flex flex-col gap-2 px-3.5 pt-2 pb-[calc(env(safe-area-inset-bottom)+12px)]"
            : "contents",
        )}
      >
        <div className={isIOS() ? "flex" : "mx-3 mt-3 flex"}>
          <WorkingDirectoryButton
            profile={profile}
            cwd={cwd}
            locked={cwdLocked}
            connected={connected}
            isNewConversation={isNewConversation}
            onSetCwd={setCwd}
          />
        </div>

        <Composer
          ref={composerRef}
          disabled={!connected}
          turnInFlight={turnInFlight}
          onStop={stopTurn}
          pendingImages={images.pending}
          uploadingImage={images.uploading}
          onAddFiles={(files) => void images.addFiles(files)}
          onRemoveImage={images.remove}
          permissionMode={permissionMode}
          onChangePermissionMode={setPermissionMode}
          contextUsage={contextUsage}
          compactBoundary={compactBoundary}
          onSend={(text, sentImages) => {
            log.addUserMessage(text, sentImages);
            sendMessage(buildWireMessage(text, sentImages));
            images.clearWithoutRevoke();
            setTurnInFlight(true);
            onActivity?.();
          }}
        />
      </div>
    </div>
  );
}
