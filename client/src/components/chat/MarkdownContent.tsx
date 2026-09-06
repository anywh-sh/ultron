import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { handleExternalLinkClick } from "@/lib/externalLink";
import { MarkdownCodeBlock } from "@/components/chat/MarkdownCodeBlock";

/**
 * GFM + syntax-highlighted code blocks + external links opened via the
 * platform's own handler — extracted from `AssistantText` (docs/41) so the
 * work dir file panel's markdown viewer can render `.md` files the exact
 * same way the chat does, without duplicating the plugin list or the link
 * handling.
 */
export function MarkdownContent({ text }: { text: string }) {
  return (
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
  );
}
