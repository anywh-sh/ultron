import { useEffect, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { useRelayClient } from "@/hooks/useRelayClient";
import { useMessageLog } from "@/hooks/useMessageLog";
import { useImageUpload, type PendingImage } from "@/hooks/useImageUpload";
import { MessageLog } from "@/components/chat/MessageLog";
import { MessageLogSkeleton } from "@/components/chat/MessageLogSkeleton";
import { TurnIndicator } from "@/components/chat/TurnIndicator";
import { Composer, type ComposerHandle } from "@/components/chat/Composer";
import { WorkingDirectoryButton } from "@/components/chat/WorkingDirectoryButton";
import type { Profile } from "@/lib/profiles";

interface ChatPanelProps {
  profile: Profile;
  sessionId: string;
  onTurnComplete?: () => void;
  onTurnActiveChange?: (active: boolean) => void;
  /** Título inferido do primeiro prompt (ou de um rename ao vivo em outro
   * dispositivo) chegando pela WS dessa sessão — ver sharedSession.ts. */
  onTitle?: (title: string) => void;
}

function buildWireMessage(text: string, images: PendingImage[]): string {
  const imageRefs = images.map((image) => `[imagem anexada: ${image.path}]`).join("\n");
  return [text, imageRefs].filter(Boolean).join("\n\n");
}

export function ChatPanel({ profile, sessionId, onTurnComplete, onTurnActiveChange, onTitle }: ChatPanelProps) {
  const log = useMessageLog();
  const logRef = useRef(log);
  logRef.current = log;
  const onTurnActiveChangeRef = useRef(onTurnActiveChange);
  onTurnActiveChangeRef.current = onTurnActiveChange;
  const onTitleRef = useRef(onTitle);
  onTitleRef.current = onTitle;

  // O relay reenvia o histórico inteiro da sessão a cada conexão nova
  // (`SharedSession.addClient`), inclusive `turn_complete` de turnos
  // antigos — necessário pra reconstruir o log de mensagens ao reabrir uma
  // aba, mas não deve contar como "turno concluído" pra badge/notificação.
  // `caughtUpRef` fica `true` só depois do marcador `caught_up`, que o relay
  // manda logo após o replay — daí em diante os eventos são mesmo ao vivo.
  const caughtUpRef = useRef(false);
  // Mesmo sinal, mas em state — dispara o re-render que troca o skeleton
  // pelo log de verdade. Nunca volta a `false`: o replay inicial só
  // acontece uma vez por aba, uma reconexão depois disso não deve piscar o
  // skeleton de novo.
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

  const { connected, cwd, cwdLocked, sendMessage, stopTurn, setCwd } = useRelayClient(profile, sessionId, {
    onEvent: (event) => logRef.current.handleEvent(event),
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
  });

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

      {ready ? <MessageLog entries={log.entries} streamingEntries={log.streamingEntries} /> : <MessageLogSkeleton />}

      {turnInFlight && <TurnIndicator />}

      <div className="mx-3 mt-3 flex">
        <WorkingDirectoryButton profile={profile} cwd={cwd} locked={cwdLocked} connected={connected} onSetCwd={setCwd} />
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
        onSend={(text, sentImages) => {
          log.addUserMessage(text, sentImages);
          sendMessage(buildWireMessage(text, sentImages));
          images.clearWithoutRevoke();
          setTurnInFlight(true);
        }}
      />
    </div>
  );
}
