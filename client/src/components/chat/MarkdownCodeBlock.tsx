import { useRef, useState, type ComponentProps } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDict } from "@/i18n";

/** Override of `pre` in `MarkdownContent`'s `ReactMarkdown` — the code block
 * gets a header bar, and the copy button lives in it.
 *
 * It used to float in the top-right corner of the code itself, revealed on
 * hover, which meant it sat on top of the first line and covered whatever
 * was written there. A bar of its own costs one row and covers nothing. The
 * design puts the source file's path on the left of that bar; a fenced block
 * in the middle of a reply has no file behind it, only the language the
 * fence declared, so the left side stays empty here rather than repeating
 * something the code itself already makes obvious.
 *
 * Reads the text via the `<pre>`'s own `textContent` at click time instead
 * of recomposing it from `children` (which arrives with rehype-highlight
 * spans already in it). */
export function MarkdownCodeBlock({ children, className, ...props }: ComponentProps<"pre">) {
  const dict = useDict();
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    // The block's `textContent` comes with a trailing newline (the markdown
    // code preserves the "\n" before the closing ```) — without the trim,
    // pasting always left the cursor on a blank line after the content
    // instead of right after the last character.
    const text = (preRef.current?.textContent ?? "").trimEnd();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.alert(dict.chat.code.copyFailed);
    }
  }

  return (
    <div className="border border-border bg-card">
      <div className="flex items-center justify-end border-b border-border-soft bg-bg-chrome px-1.5 py-1">
        <Button type="button" variant="ghost" size="xs" onClick={() => void handleCopy()}>
          {copied ? <Check /> : <Copy />}
          {copied ? dict.chat.code.copied : dict.chat.code.copy}
        </Button>
      </div>
      <pre ref={preRef} className={className} {...props}>
        {children}
      </pre>
    </div>
  );
}
