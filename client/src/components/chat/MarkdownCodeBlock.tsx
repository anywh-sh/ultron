import { useRef, useState, type ComponentProps } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { isIOS } from "@/lib/platform";

/** Override do `pre` no `ReactMarkdown` do `AssistantText` — bloco de código
 * ganha um botão de copiar no canto superior direito. O botão fica FORA do
 * `<pre>` (num wrapper `relative` por cima), não dentro dele: `.prose-chat
 * pre` tem `overflow-x: auto` (blocos longos rolam horizontalmente), e um
 * filho `absolute` de um elemento com scroll rola junto com o conteúdo —
 * ficava se arrastando pro lado ao rolar em vez de continuar fixo no canto.
 * Hover-only no desktop (opacity-0/group-hover) — sempre visível some com a
 * necessidade de sobrepor o código só quando o usuário já pediu pra ver o
 * botão. Sempre visível no iOS, que não tem hover: apareceria só ao tocar
 * (e some de novo), o que não ajuda em nada. Lê o texto via `textContent` do
 * próprio `<pre>` na hora do clique em vez de tentar recompor a partir de
 * `children` (que já vem com spans do rehype-highlight — pegar do DOM
 * renderizado é o jeito simples de ter o texto puro de volta). */
export function MarkdownCodeBlock({ children, className, ...props }: ComponentProps<"pre">) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    // `textContent` do bloco vem com uma quebra de linha final (o código do
    // markdown preserva o "\n" antes do ``` de fechamento) — sem o trim, colar
    // sempre deixava o cursor numa linha em branco depois do conteúdo em vez
    // de logo após o último caractere.
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
