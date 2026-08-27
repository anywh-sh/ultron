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
import { TerminalToggleButton } from "@/components/chat/TerminalToggleButton";
import { isIOS } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { parseSlashCommand } from "@/lib/slashCommands";
import type { Profile } from "@/lib/profiles";

interface ChatPanelProps {
  profile: Profile;
  sessionId: string;
  /** Aba aberta via "nova conversa" — mostra o estado ocioso em vez do
   * skeleton de carregamento enquanto o log ainda está vazio. */
  isNewConversation?: boolean;
  /** `lastUserText` é a última mensagem que o usuário mandou nesse turno
   * (extraída sincronamente do log, sem round-trip) — `App` usa isso como
   * corpo de fallback da notificação do SO, se o resumo abaixo não chegar
   * a tempo. */
  onTurnComplete?: (result: { stopped: boolean; lastUserText: string | null }) => void;
  /** Resumo do que a resposta fez (ou deixou pendente), gerado de forma
   * assíncrona depois de `onTurnComplete` (ver relay-types.ts::notification_summary)
   * — `App` usa isso como corpo da notificação, com o `lastUserText` acima
   * como fallback se não chegar a tempo. */
  onNotificationSummary?: (text: string | null) => void;
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
  /** Terminal embutido (docs/30) — desktop only, `App` passa `undefined` no
   * iOS/viewport compacto e o botão nem aparece (ver renderPanel). */
  terminal?: {
    open: boolean;
    onToggle: () => void;
  };
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
  onNotificationSummary,
  onTurnActiveChange,
  onTitle,
  onActivity,
  onDeleted,
  onConnectedChange,
  terminal,
}: ChatPanelProps) {
  const log = useMessageLog();
  const logRef = useRef(log);
  logRef.current = log;
  const onTurnActiveChangeRef = useRef(onTurnActiveChange);
  onTurnActiveChangeRef.current = onTurnActiveChange;
  const onTitleRef = useRef(onTitle);
  onTitleRef.current = onTitle;
  const onNotificationSummaryRef = useRef(onNotificationSummary);
  onNotificationSummaryRef.current = onNotificationSummary;
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
    model,
    defaultModel,
    contextUsage,
    compactBoundary,
    suggestion,
    dismissSuggestion,
    sendMessage,
    stopTurn,
    setCwd,
    setPermissionMode,
    setModel,
    clearConversation,
  } = useRelayClient(profile, sessionId, {
    onEvent: (event) => logRef.current.handleEvent(event),
    onReconnecting: () => {
      logRef.current.reset();
      caughtUpRef.current = false;
      setReady(false);
    },
    // `/clear` (docs/26) — mesma limpeza de log que uma reconexão de verdade
    // já faz, só que sem passar por `ready`/skeleton (a conversa continua
    // "pronta", só ficou vazia).
    onConversationReset: () => logRef.current.reset(),
    onCaughtUp: () => {
      caughtUpRef.current = true;
      setReady(true);
    },
    onTurnComplete: (stopped) => {
      logRef.current.handleTurnComplete(stopped);
      setTurnInFlight(false);
      if (!caughtUpRef.current) return;
      const lastUserEntry = [...logRef.current.entries].reverse().find((entry) => entry.kind === "user");
      onTurnComplete?.({ stopped, lastUserText: lastUserEntry?.kind === "user" ? lastUserEntry.text : null });
    },
    onTurnError: (message) => {
      logRef.current.handleTurnError(message);
      setTurnInFlight(false);
    },
    onSetCwdError: (message) => window.alert(`Não foi possível trocar a pasta: ${message}`),
    onNotificationSummary: (text) => onNotificationSummaryRef.current?.(text),
    onSessionTitle: (title) => onTitleRef.current?.(title),
    onSessionDeleted: () => onDeletedRef.current?.(),
  });

  const onConnectedChangeRef = useRef(onConnectedChange);
  onConnectedChangeRef.current = onConnectedChange;
  useEffect(() => {
    onConnectedChangeRef.current?.(connected);
  }, [connected]);

  // Foca o composer assim que a aba de uma conversa nova monta — permite
  // digitar de cara sem precisar clicar no campo (ex.: Ctrl/Cmd+N e já
  // começar a escrever).
  useEffect(() => {
    if (isNewConversation) composerRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      {(isNewConversation || ready) && log.entries.length === 0 && log.streamingEntries.length === 0 ? (
        // `isNewConversation` cobre a aba recém-aberta (mostra ocioso na hora,
        // sem esperar `ready` — não tem nada mesmo pra carregar). `ready`
        // cobre uma sessão existente que ficou vazia de verdade — depois de
        // um `/clear` (docs/26), por exemplo — sem essa segunda condição a
        // tela ficava só em branco (nem ocioso nem skeleton) até o próximo
        // turno, porque `isNewConversation` já era `false` há muito tempo.
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
        <div className={isIOS() ? "flex items-center justify-between" : "mx-3 mt-3 flex items-center justify-between"}>
          <WorkingDirectoryButton
            profile={profile}
            cwd={cwd}
            locked={cwdLocked}
            connected={connected}
            isNewConversation={isNewConversation}
            onSetCwd={setCwd}
            onFocusComposer={() => composerRef.current?.focus()}
          />
          {terminal && <TerminalToggleButton cwd={cwd} open={terminal.open} onToggle={terminal.onToggle} />}
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
          model={model}
          defaultModel={defaultModel}
          contextUsage={contextUsage}
          compactBoundary={compactBoundary}
          suggestion={suggestion}
          onSend={(text, sentImages) => {
            // `/model`/`/clear` (docs/26): reconhecidos aqui, antes de virar
            // turno — nenhum dos dois passa como texto pro `claude -p` (ver
            // slashCommands.ts pro motivo de cada um). Comando com argumento
            // não curado (`/model gpt4`) cai no `else`, vira mensagem normal
            // e a própria CLI responde com o erro dela.
            const command = parseSlashCommand(text);
            if (command?.name === "clear") {
              clearConversation();
              return;
            }
            if (command?.name === "model") {
              setModel(command.model);
              return;
            }
            log.addUserMessage(text, sentImages);
            sendMessage(buildWireMessage(text, sentImages));
            images.clearWithoutRevoke();
            setTurnInFlight(true);
            dismissSuggestion();
            onActivity?.();
          }}
        />
      </div>
    </div>
  );
}
