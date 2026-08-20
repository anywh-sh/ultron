import { useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { useRelayClient } from "@/hooks/useRelayClient";
import { useMessageLog } from "@/hooks/useMessageLog";
import { useImageUpload, type PendingImage } from "@/hooks/useImageUpload";
import { MessageLog } from "@/components/chat/MessageLog";
import { TurnIndicator } from "@/components/chat/TurnIndicator";
import { Composer, type ComposerHandle } from "@/components/chat/Composer";
import type { Profile } from "@/lib/profiles";

interface ChatPanelProps {
  profile: Profile;
  sessionName: string;
  onTurnComplete?: () => void;
}

function buildWireMessage(text: string, images: PendingImage[]): string {
  const imageRefs = images.map((image) => `[imagem anexada: ${image.path}]`).join("\n");
  return [text, imageRefs].filter(Boolean).join("\n\n");
}

export function ChatPanel({ profile, sessionName, onTurnComplete }: ChatPanelProps) {
  const log = useMessageLog();
  const logRef = useRef(log);
  logRef.current = log;

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

  const { connected, sendMessage } = useRelayClient(profile, sessionName, {
    onEvent: (event) => logRef.current.handleEvent(event),
    onTurnComplete: () => {
      logRef.current.handleTurnComplete();
      setTurnInFlight(false);
      onTurnComplete?.();
    },
    onTurnError: (message) => {
      logRef.current.handleTurnError(message);
      setTurnInFlight(false);
    },
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

      <MessageLog entries={log.entries} streamingEntries={log.streamingEntries} />

      {turnInFlight && <TurnIndicator />}

      <Composer
        ref={composerRef}
        disabled={!connected}
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
