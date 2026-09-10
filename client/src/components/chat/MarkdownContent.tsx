import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { handleExternalLinkClick } from "@/lib/externalLink";
import { looksLikeFilePath } from "@/lib/filePathLinks";
import { MarkdownCodeBlock } from "@/components/chat/MarkdownCodeBlock";

/**
 * GFM + syntax-highlighted code blocks + external links opened via the
 * platform's own handler — extracted from `AssistantText` (docs/41) so the
 * work dir file panel's markdown viewer can render `.md` files the exact
 * same way the chat does, without duplicating the plugin list or the link
 * handling.
 *
 * `onOpenPath` is optional — only the chat call site (`Message.tsx`) wires
 * it up (desktop only, matching the file panel itself); the file panel's
 * own `.md` viewer (`MarkdownFileView`) reuses this component without it,
 * so an inline path mentioned inside a previewed markdown file just renders
 * as plain code, unchanged.
 */
export function MarkdownContent({ text, onOpenPath }: { text: string; onOpenPath?: (path: string) => void }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        a: ({ href, ...props }) => (
          <a {...props} href={href} rel="noopener noreferrer" onClick={(event) => href && handleExternalLinkClick(event, href)} />
        ),
        pre: MarkdownCodeBlock,
        // Only inline spans (no `className` — react-markdown/remark only
        // stamps `language-xxx` on a fenced block's `code`, never on an
        // inline one) are candidates: a fenced block's own `code` still
        // renders through here as a second pass, and linkifying paths
        // inside real code snippets would fight rehype-highlight's spans
        // for the same text.
        code: ({ className, children, ...props }) => {
          const text = typeof children === "string" ? children : String(children);
          if (onOpenPath && !className && looksLikeFilePath(text)) {
            return (
              <button type="button" className="prose-chat-path-link" onClick={() => onOpenPath(text)}>
                {text}
              </button>
            );
          }
          return (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
