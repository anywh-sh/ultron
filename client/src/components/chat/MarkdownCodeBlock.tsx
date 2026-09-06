import { useRef, useState, type ComponentProps } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { isIOS } from "@/lib/platform";

/** Override of `pre` in `AssistantText`'s `ReactMarkdown` — the code block
 * gets a copy button in the top-right corner. The button sits OUTSIDE the
 * `<pre>` (in a `relative` wrapper over it), not inside it: `.prose-chat
 * pre` has `overflow-x: auto` (long blocks scroll horizontally), and an
 * `absolute` child of a scrolling element scrolls along with the content —
 * it would drag sideways while scrolling instead of staying fixed in the
 * corner. Hover-only on desktop (opacity-0/group-hover) — always-visible
 * removes the need to overlay the code only when the user has actually
 * asked to see the button. Always visible on iOS, which has no hover: it
 * would only appear on tap (then disappear again), which doesn't help at
 * all. Reads the text via the `<pre>`'s own `textContent` at click time
 * instead of trying to recompose it from `children` (which already comes
 * with rehype-highlight spans — grabbing it from the rendered DOM is the
 * simple way to get the plain text back). */
export function MarkdownCodeBlock({ children, className, ...props }: ComponentProps<"pre">) {
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
      window.alert("Não foi possível copiar o código.");
    }
  }

  return (
    <div className="group relative">
      <pre ref={preRef} className={className} {...props}>
        {children}
      </pre>
      <button
        type="button"
        onClick={() => void handleCopy()}
        aria-label={copied ? "Copiado" : "Copiar código"}
        className={cn(
          "absolute top-2 right-2 flex size-6 cursor-pointer items-center justify-center rounded-md bg-card text-muted-foreground transition-opacity hover:bg-border hover:text-foreground",
          isIOS() ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}
