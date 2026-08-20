import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { PendingImage } from "@/hooks/useImageUpload";
import { renderTextWithLinks } from "@/lib/composerLinks";
import { handleExternalLinkClick } from "@/lib/externalLink";

interface UserBubbleProps {
  text: string;
  images?: PendingImage[];
}

/** Preview aparece dentro da mensagem enviada, não só como chip pré-envio —
 * docs/17. */
export function UserBubble({ text, images }: UserBubbleProps) {
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
}

export function AssistantText({ text }: { text: string }) {
  return (
    <div className="prose-chat text-sm text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ href, ...props }) => (
            <a {...props} href={href} rel="noopener noreferrer" onClick={(event) => href && handleExternalLinkClick(event, href)} />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
