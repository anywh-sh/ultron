import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { PendingImage } from "@/hooks/useImageUpload";
import { renderTextWithLinks } from "@/lib/composerLinks";
import { handleExternalLinkClick } from "@/lib/externalLink";
import { MarkdownCodeBlock } from "@/components/chat/MarkdownCodeBlock";

interface UserBubbleProps {
  text: string;
  images?: PendingImage[];
}

/** Preview aparece dentro da mensagem enviada, não só como chip pré-envio —
 * docs/17.
 *
 * Memoizado (igual `AssistantText` abaixo): sem isso, cada token do
 * streaming re-renderiza o `MessageLog` inteiro, e sem `memo` o React
 * re-executa TODAS as mensagens já commitadas de novo (incluindo o parse de
 * markdown + syntax highlighting das antigas), não só a que está sendo
 * escrita agora — é a causa raiz da lentidão durante geração ativa. */
export const UserBubble = memo(function UserBubble({ text, images }: UserBubbleProps) {
  return (
    <div className="flex justify-end">
      <div className="flex max-w-[80%] flex-col gap-2 rounded-2xl bg-bubble-user px-3.5 py-2 text-sm text-foreground">
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
      </div>
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
