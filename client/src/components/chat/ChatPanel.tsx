import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { useRelayClient } from "@/hooks/useRelayClient";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { useMessageLog, type LogEntry } from "@/hooks/useMessageLog";
import { useImageUpload, type PendingImage } from "@/hooks/useImageUpload";
import { MessageLog } from "@/components/chat/MessageLog";
import { MessageLogSkeleton } from "@/components/chat/MessageLogSkeleton";
import { ChatIdleState } from "@/components/chat/ChatIdleState";
import { TurnIndicator } from "@/components/chat/TurnIndicator";
import { Composer, type ComposerHandle } from "@/components/chat/Composer";
import { WorkingDirectoryButton } from "@/components/chat/WorkingDirectoryButton";
import { TerminalToggleButton } from "@/components/chat/TerminalToggleButton";
import { BackgroundJobIndicator } from "@/components/chat/BackgroundJobIndicator";
import type { BackgroundJobSummary } from "@/lib/relayClient";
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
  /** Jobs `ultron-bg` observados agora nesta sessão, sempre que a lista muda
   * — mesmo padrão de `onTurnActiveChange` (docs/32, Fase E): `App` usa isso
   * pra alimentar o badge da aba/sidebar, que precisa saber mesmo com a aba
   * fora de foco (continua montada, WS viva, docs/18). */
  onBackgroundJobsChange?: (jobs: BackgroundJobSummary[]) => void;
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

/** Edição de mensagem (docs/33) — conta quantas entries `kind: "user"`
 * existem entre `id` e o fim de `entries` (inclusive), contando do fim (`1`
 * = a última). É sempre calculável a partir do que já está carregado: a
 * paginação do histórico carrega de trás pra frente, então tudo que vem
 * DEPOIS de uma mensagem já renderizada também já está carregado. `null` se
 * `id` não for encontrado (não deveria acontecer — o id vem de uma entry
 * renderizada agora mesmo). */
function computeFromEnd(entries: LogEntry[], id: string): number | null {
  let count = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.kind !== "user") continue;
    count++;
    if (entry.id === id) return count;
  }
  return null;
}

export function ChatPanel({
  profile,
  sessionId,
  isNewConversation,
  onTurnComplete,
  onNotificationSummary,
  onTurnActiveChange,
  onBackgroundJobsChange,
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
  const onBackgroundJobsChangeRef = useRef(onBackgroundJobsChange);
  onBackgroundJobsChangeRef.current = onBackgroundJobsChange;
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

  // Edição de mensagem (docs/33). `fromEnd` é calculado uma vez, no momento
  // do clique em "editar" (`computeFromEnd`), e guardado aqui em vez de
  // recalculado no momento de salvar — evita depender do log não ter mudado
  // no meio do caminho. `editTargetRef`/`performEditRef` existem pra
  // `onStartEdit`/`onSaveEdit`/`onSend` lerem sempre o valor mais recente
  // sem entrar como dependência de `useCallback` nenhum — é o que mantém a
  // identidade desses callbacks estável entre renders (ver comentário do
  // `memo` em `Message.tsx`: sem isso, TODAS as bolhas perderiam o bail-out
  // do memo a cada render do `ChatPanel`, não só a que está sendo editada).
  const [editTarget, setEditTarget] = useState<{ id: string; fromEnd: number } | null>(null);
  const editTargetRef = useRef(editTarget);
  editTargetRef.current = editTarget;
  const performEditRef = useRef<(id: string, text: string) => void>(() => {});

  // Contador em vez de um boolean simples: dragenter/dragleave disparam pra
  // cada elemento filho sobrevoado, um simples enter/leave "pisca" o overlay
  // ao passar por cima de itens do log. Só esconde quando o contador zera.
  const dragCounterRef = useRef(0);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Cobre do clique em "Enviar" até o turno terminar (sucesso ou erro) — não
  // só o tempo de resposta do modelo, também a ida/volta de rede, pra nunca
  // dar sensação de travado (feedback do usuário). Guarda o instante de
  // início (não só um booleano) pro `TurnIndicator` cronometrar a partir do
  // início real do turno, não de quando este componente soube — importante
  // pro dispositivo que NÃO mandou a mensagem (ver `onTurnState` abaixo,
  // achado testando multi-dispositivo: sem isso só quem mandou via o
  // indicador de "pensando"). Otimista aqui (`Date.now()` no clique de
  // enviar, antes do round-trip com o relay), corrigido pelo `startedAt` de
  // verdade assim que `onTurnState` chegar.
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const turnInFlight = turnStartedAt !== null;

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
    loadOlderHistory,
    backgroundJobs,
    cancelBackgroundJob,
    editMessage,
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
    // Cauda inicial do histórico (Fase 2-4, docs/30) — chega antes de
    // `onCaughtUp`, hidrata o log com um dispatch só em vez do replay antigo
    // evento-a-evento.
    onHistoryPage: (page) => logRef.current.hydrate(page),
    // Turnos mais antigos pedidos via scroll pra cima (Fase 5, docs/30).
    onOlderHistory: (page) => logRef.current.prependHistory(page),
    // Edição de mensagem em OUTRO dispositivo conectado nesta sessão
    // (docs/33) — mesmo tratamento de reset+hydrate de `onReconnecting`/
    // `onHistoryPage`, só que sem tocar em `ready`/`caughtUpRef`: este
    // dispositivo já está em dia, não é uma reconexão de verdade.
    onHistoryTruncated: (page) => {
      logRef.current.reset();
      logRef.current.hydrate(page);
    },
    onEditMessageError: (message) => window.alert(message),
    onCaughtUp: () => {
      caughtUpRef.current = true;
      setReady(true);
    },
    onTurnComplete: (stopped) => {
      logRef.current.handleTurnComplete(stopped);
      setTurnStartedAt(null);
      if (!caughtUpRef.current) return;
      const lastUserEntry = [...logRef.current.entries].reverse().find((entry) => entry.kind === "user");
      onTurnComplete?.({ stopped, lastUserText: lastUserEntry?.kind === "user" ? lastUserEntry.text : null });
    },
    onTurnError: (message) => {
      logRef.current.handleTurnError(message);
      setTurnStartedAt(null);
    },
    // Turno em andamento é estado da SESSÃO, não de quem mandou — sem isso,
    // um dispositivo que não iniciou o turno (ou que conecta no meio dele)
    // nunca via o indicador de "pensando"/cronômetro (achado real testando
    // multi-dispositivo). `startedAt` do relay corrige o cronômetro pro
    // início de verdade; o `setTurnStartedAt(Date.now())` otimista do envio
    // (Composer.onSend) já cobre o instante entre o clique e este evento
    // chegar de volta.
    onTurnState: (state) => setTurnStartedAt(state.active ? (state.startedAt ?? Date.now()) : null),
    onSetCwdError: (message) => window.alert(`Não foi possível trocar a pasta: ${message}`),
    onNotificationSummary: (text) => onNotificationSummaryRef.current?.(text),
    onSessionTitle: (title) => onTitleRef.current?.(title),
    onSessionDeleted: () => onDeletedRef.current?.(),
  });

  // Mesmo padrão de `onTurnActiveChange` acima: reporta pro Tab via ref —
  // abas em background continuam montadas (docs/18), então isso também
  // cobre um job terminando fora da aba/perfil visível no momento (docs/32,
  // Fase E).
  useEffect(() => {
    onBackgroundJobsChangeRef.current?.(backgroundJobs);
  }, [backgroundJobs]);

  const onConnectedChangeRef = useRef(onConnectedChange);
  onConnectedChangeRef.current = onConnectedChange;
  useEffect(() => {
    onConnectedChangeRef.current?.(connected);
  }, [connected]);

  // Edição de mensagem (docs/33): trunca localmente (otimista, igual a um
  // envio normal) e manda `edit_message` — o relay para o turno atual (se
  // houver), corta o transcript real no ponto certo e roda um turno novo. Se
  // `target.id` não bater mais com o `id` pedido (ex: outra edição já rodou
  // no meio do caminho), ignora em vez de truncar no lugar errado.
  performEditRef.current = (id, newText) => {
    const target = editTargetRef.current;
    if (!target || target.id !== id) return;
    log.editUserMessage(id, newText);
    editMessage(target.fromEnd, newText);
    setTurnStartedAt(Date.now());
    setEditTarget(null);
    dismissSuggestion();
    onActivity?.();
  };

  // Identidade estável (refs por dentro, sem depender de state/props no array
  // de deps) — ver comentário no topo do componente sobre por que isso
  // importa pro `memo` de `UserBubble`/`MessageLog`.
  const onStartEdit = useCallback((id: string, text: string) => {
    const fromEnd = computeFromEnd(logRef.current.entries, id);
    if (fromEnd === null) return;
    setEditTarget({ id, fromEnd });
    // No iOS a edição acontece via composer (docs/33: balão não vira input
    // lá) — preenche com o texto original e mostra o aviso (ver JSX abaixo).
    // No desktop isso não faz nada: `editingMessageId` já basta pro
    // `UserBubble` virar `<textarea>` sozinho.
    if (isIOS()) {
      composerRef.current?.setContent(text);
      composerRef.current?.focus();
    }
  }, []);

  const onCancelEdit = useCallback(() => {
    setEditTarget(null);
    if (isIOS()) composerRef.current?.setContent("");
  }, []);

  const onSaveEdit = useCallback((id: string, text: string) => {
    performEditRef.current(id, text);
  }, []);

  const onCopyMessage = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => {
      window.alert("Não foi possível copiar a mensagem.");
    });
  }, []);

  // Disparado pelo `MessageLog` ao rolar perto do topo (Fase 5, docs/30) — o
  // guard mora aqui (não só no `MessageLog`) porque `logRef` é a fonte de
  // verdade mais atual do estado de paginação, sem depender de re-render.
  const handleLoadOlderHistory = useCallback(() => {
    const current = logRef.current;
    if (current.loadingOlderHistory || !current.hasMoreHistory || current.historyCursor === null) return;
    current.beginLoadingOlderHistory();
    loadOlderHistory(current.historyCursor);
  }, [loadOlderHistory]);

  // Foca o composer assim que a aba de uma conversa nova monta — permite
  // digitar de cara sem precisar clicar no campo (ex.: Ctrl/Cmd+N e já
  // começar a escrever).
  useEffect(() => {
    if (isNewConversation) composerRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const keyboardInfo = useKeyboardInset();

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
          hasMoreHistory={log.hasMoreHistory}
          loadingOlderHistory={log.loadingOlderHistory}
          onLoadOlderHistory={handleLoadOlderHistory}
          className={isIOS() ? "pt-[calc(env(safe-area-inset-top)+64px)] pb-32" : undefined}
          // No iOS a edição nunca vira `<textarea>` inline (docs/33) — o
          // `ChatPanel` nunca passa um id daqui pra lá nessa plataforma,
          // mesmo com `editTarget` setado (ver aviso no composer abaixo).
          editingMessageId={isIOS() ? null : (editTarget?.id ?? null)}
          onStartEdit={onStartEdit}
          onCancelEdit={onCancelEdit}
          onSaveEdit={onSaveEdit}
          onCopy={onCopyMessage}
        />
      ) : (
        <MessageLogSkeleton />
      )}

      {!isIOS() && turnStartedAt !== null && <TurnIndicator startedAt={turnStartedAt} />}

      {/* iOS (docs/24): cwd + composer flutuam por cima do log, saindo do
       * fluxo normal — o log continua rolando visível (desfocado) por baixo
       * do glass do composer, em vez de parar acima de um bloco fixo.
       * `bottom` desloca pelo `keyboardInfo.shift` (`useKeyboardInset.ts`)
       * em vez de ficar fixo em `bottom-0` — sem isso sobra um gap indevido
       * entre o composer e o teclado (docs/34 item 1, docs/39: reproduzido
       * de novo no device físico mesmo com o fix validado no Simulator). O
       * padding de `safe-area-inset-bottom` é pra área do home indicator,
       * que deixa de existir (foi substituída pelo teclado) assim que ele
       * abre, então troca pra um `12px` fixo nesse estado — decidido por
       * `keyboardInfo.isOpen`, não por `shift > 0`: os dois podem divergir
       * se o layout encolher junto com o teclado (não confirmado se
       * acontece no device físico), caso em que `shift` corretamente vai a
       * zero mas o teclado continua aberto. */}
      <div
        className={cn(
          isIOS()
            ? cn(
                "absolute inset-x-0 z-20 flex flex-col gap-2 px-3.5 pt-2",
                keyboardInfo.isOpen ? "pb-3" : "pb-[calc(env(safe-area-inset-bottom)+12px)]",
              )
            : "contents",
        )}
        style={isIOS() ? { bottom: keyboardInfo.shift } : undefined}
      >
        <div className={isIOS() ? "flex items-center justify-between" : "mx-3 mt-3 flex items-center justify-between"}>
          <div className="flex min-w-0 items-center gap-1.5">
            <WorkingDirectoryButton
              profile={profile}
              cwd={cwd}
              locked={cwdLocked}
              connected={connected}
              isNewConversation={isNewConversation}
              onSetCwd={setCwd}
              onFocusComposer={() => composerRef.current?.focus()}
            />
            <BackgroundJobIndicator jobs={backgroundJobs} onCancel={cancelBackgroundJob} />
          </div>
          {terminal && <TerminalToggleButton cwd={cwd} open={terminal.open} onToggle={terminal.onToggle} />}
        </div>

        {/* iOS (docs/33): edição não vira `<textarea>` inline no balão (ver
         * `editingMessageId` acima) — preenche o composer normal com o texto
         * original e mostra este aviso, já que enviar a partir daqui vai
         * descartar a resposta original e tudo que veio depois dela. */}
        {isIOS() && editTarget && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-bg-elevated/80 px-3 py-2 text-xs text-muted-foreground backdrop-blur-lg">
            <span>Editando essa mensagem vai recomeçar a conversa a partir desse ponto.</span>
            <button
              type="button"
              onClick={onCancelEdit}
              aria-label="Cancelar edição"
              className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {/* No iOS o indicador de turno mora aqui dentro (não em document flow
         * normal, como no desktop) — este bloco inteiro é `absolute
         * bottom-0` (ver comentário acima), então um elemento fora dele
         * vazava pra fora da área flutuante e acabava renderizando abaixo do
         * composer (perto do teclado) em vez de acima. */}
        {isIOS() && turnStartedAt !== null && <TurnIndicator startedAt={turnStartedAt} />}

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
            // Edição via composer (docs/33, iOS) — o envio normal (comandos
            // de barra, `addUserMessage`+`sendMessage`) não se aplica aqui:
            // o texto vai pro `edit_message`, não pro `user_message`.
            // Imagens anexadas nesse estado são ignoradas de propósito
            // (editar mensagem com imagem é fora de escopo da v1).
            if (editTargetRef.current) {
              performEditRef.current(editTargetRef.current.id, text);
              return;
            }
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
            setTurnStartedAt(Date.now());
            dismissSuggestion();
            onActivity?.();
          }}
        />
      </div>
    </div>
  );
}
