import { memo, useEffect, useReducer, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy, Pencil } from "lucide-react";
import type { PendingImage } from "@/hooks/useImageUpload";
import { useLongPress } from "@/hooks/useLongPress";
import { renderTextWithLinks } from "@/lib/composerLinks";
import { handleExternalLinkClick } from "@/lib/externalLink";
import { isIOS } from "@/lib/platform";
import { showNativeContextMenu } from "@/lib/nativeContextMenu";
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/relativeTime";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MarkdownCodeBlock } from "@/components/chat/MarkdownCodeBlock";

const IMAGE_EDIT_DISABLED_REASON = "Editar mensagem com imagem ainda não é suportado";

interface UserBubbleProps {
  id: string;
  text: string;
  images?: PendingImage[];
  sentAt: number;
  isEditing: boolean;
  onStartEdit: (id: string, text: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string, text: string) => void;
  onCopy: (text: string) => void;
}

/** Timestamp relativo ("há 3 min") com tooltip revelando a hora exata —
 * componente próprio só pra isolar o tick de 60s (re-render) do resto do
 * `UserBubble`, que não precisa re-renderizar com o tempo passando. */
function TimestampLabel({ sentAt }: { sentAt: number }) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const interval = window.setInterval(tick, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default select-none">{formatRelativeTime(sentAt)}</span>
      </TooltipTrigger>
      <TooltipContent side="top">{formatAbsoluteTime(sentAt)}</TooltipContent>
    </Tooltip>
  );
}

/** Preview aparece dentro da mensagem enviada, não só como chip pré-envio —
 * docs/17. Editar/copiar/timestamp — docs/33.
 *
 * Memoizado (igual `AssistantText` abaixo): sem isso, cada token do
 * streaming re-renderiza o `MessageLog` inteiro, e sem `memo` o React
 * re-executa TODAS as mensagens já commitadas de novo (incluindo o parse de
 * markdown + syntax highlighting das antigas), não só a que está sendo
 * escrita agora — é a causa raiz da lentidão durante geração ativa. Os
 * callbacks (`onStartEdit` etc.) precisam ter identidade estável vindo do
 * chamador (refs, não closures novas a cada render de `ChatPanel`), senão
 * esse `memo` não segura nada — ver `ChatPanel.tsx`. */
export const UserBubble = memo(function UserBubble({
  id,
  text,
  images,
  sentAt,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onCopy,
}: UserBubbleProps) {
  const editDisabled = Boolean(images && images.length > 0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isEditing) return;
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = `${String(el.scrollHeight)}px`;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [isEditing]);

  function autoResize(): void {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${String(el.scrollHeight)}px`;
  }

  function handleSave(): void {
    const value = textareaRef.current?.value.trim() ?? "";
    if (value) onSaveEdit(id, value);
  }

  function handleCopy(): void {
    onCopy(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // Long-press (iOS, docs/33) — abre o menu nativo (`UIEditMenuInteraction`)
  // no ponto do toque, com Copiar/Editar. Só faz sentido chamar em
  // plataforma iOS; em desktop a interação é hover + clique nos ícones
  // abaixo do balão (ver `!isIOS()` no JSX).
  const longPress = useLongPress({
    onLongPress: (point) => {
      void showNativeContextMenu(
        [
          { id: "copy", label: "Copiar", systemIcon: "doc.on.doc" },
          {
            id: "edit",
            label: "Editar",
            systemIcon: "pencil",
            disabled: editDisabled,
            disabledReason: editDisabled ? IMAGE_EDIT_DISABLED_REASON : undefined,
          },
        ],
        point,
      ).then((selectedId) => {
        if (selectedId === "copy") handleCopy();
        else if (selectedId === "edit" && !editDisabled) onStartEdit(id, text);
      });
    },
  });

  return (
    <div className="group flex flex-col items-end">
      <div
        className={cn(
          "flex max-w-[80%] flex-col gap-2 rounded-2xl px-3.5 py-2 text-sm text-foreground",
          isEditing ? "w-[80%] bg-bg-elevated" : "bg-bubble-user",
        )}
        {...(isIOS() && !isEditing ? longPress : undefined)}
      >
        {isEditing ? (
          <textarea
            ref={textareaRef}
            defaultValue={text}
            onInput={autoResize}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                handleSave();
              } else if (event.key === "Escape") {
                onCancelEdit();
              }
            }}
            rows={1}
            className="w-full resize-none bg-transparent text-sm text-foreground outline-none"
          />
        ) : (
          <>
            {images && images.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {images.map((image) => (
                  <img
                    key={image.path}
                    src={image.previewUrl}
                    alt=""
                    className="max-h-48 max-w-full rounded-lg object-cover"
                  />
                ))}
              </div>
            )}
            {text && <p className="whitespace-pre-wrap">{renderTextWithLinks(text)}</p>}
          </>
        )}
      </div>

      {isEditing ? (
        <div className="mt-1 flex h-7 items-center justify-end gap-1.5">
          <Button type="button" size="sm" variant="ghost" onClick={onCancelEdit}>
            Cancelar
          </Button>
          <Button type="button" size="sm" onClick={handleSave}>
            Salvar
          </Button>
        </div>
      ) : (
        // Faixa de ações sempre presente (altura fixa reservada, só o
        // conteúdo alterna opacidade) — é o que cria o espaçamento pedido
        // antes da resposta do agente, e evita o balão "pular" quando o
        // hover revela os ícones (o virtualizador mede a altura do item
        // inteiro, incluindo esta faixa). Escondida por completo no iOS
        // (interação é o long-press acima, não hover — não existe hover em
        // touch).
        !isIOS() && (
          <div className="mt-1 flex h-6 items-center justify-end gap-1 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
            <TimestampLabel sentAt={sentAt} />
            <button
              type="button"
              onClick={handleCopy}
              aria-label={copied ? "Copiado" : "Copiar mensagem"}
              className="flex size-6 cursor-pointer items-center justify-center rounded-md hover:bg-border hover:text-foreground"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </button>
            {editDisabled ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* Wrapper `span`: um `button disabled` não recebe evento de
                   * ponteiro nenhum, então o Tooltip nunca abriria se o
                   * trigger fosse o próprio botão. */}
                  <span>
                    <button
                      type="button"
                      disabled
                      aria-label="Editar mensagem (indisponível)"
                      className="flex size-6 cursor-not-allowed items-center justify-center rounded-md text-text-faint"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">{IMAGE_EDIT_DISABLED_REASON}</TooltipContent>
              </Tooltip>
            ) : (
              <button
                type="button"
                onClick={() => onStartEdit(id, text)}
                aria-label="Editar mensagem"
                className="flex size-6 cursor-pointer items-center justify-center rounded-md hover:bg-border hover:text-foreground"
              >
                <Pencil className="size-3.5" />
              </button>
            )}
          </div>
        )
      )}
    </div>
  );
});

/** Memoizado — ver comentário em `UserBubble`. `ReactMarkdown` +
 * `rehype-highlight` reparseiam markdown e re-executam o syntax highlighting
 * inteiros a cada render; sem `memo`, isso rodava de novo pra cada mensagem
 * antiga a cada token novo streamado em QUALQUER mensagem da conversa. */
export const AssistantText = memo(function AssistantText({ text }: { text: string }) {
  return (
    <div className="prose-chat text-sm text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ href, ...props }) => (
            <a {...props} href={href} rel="noopener noreferrer" onClick={(event) => href && handleExternalLinkClick(event, href)} />
          ),
          pre: MarkdownCodeBlock,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
