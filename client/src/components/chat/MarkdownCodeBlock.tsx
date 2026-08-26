import { useRef, useState, type ComponentProps } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/** Override do `pre` no `ReactMarkdown` do `AssistantText` — bloco de código
 * ganha um botão de copiar no canto superior direito. Sempre visível (não
 * hover-only): ultron roda em iOS também, onde não existe hover — um botão
 * que só aparece no mouseover nunca apareceria no toque. Lê o texto via
 * `textContent` do próprio `<pre>` na hora do clique em vez de tentar
 * recompor a partir de `children` (que já vem com spans do rehype-highlight
 * — pegar do DOM renderizado é o jeito simples de ter o texto puro de
 * volta). */
export function MarkdownCodeBlock({ children, className, ...props }: ComponentProps<"pre">) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    const text = preRef.current?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.alert("Não foi possível copiar o código.");
    }
  }

  return (
    <pre ref={preRef} className={cn("relative", className)} {...props}>
      {children}
      <button
        type="button"
        onClick={() => void handleCopy()}
        aria-label={copied ? "Copiado" : "Copiar código"}
        className="absolute top-2 right-2 flex size-6 cursor-pointer items-center justify-center rounded-md bg-card text-muted-foreground transition-colors hover:bg-border hover:text-foreground"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </pre>
  );
}
