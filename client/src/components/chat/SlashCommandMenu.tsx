import type { SlashCommandEntry } from "@/lib/slashCommands";
import { cn } from "@/lib/utils";

interface SlashCommandMenuProps {
  items: SlashCommandEntry[];
  selectedIndex: number;
  onHover: (index: number) => void;
  onPick: (entry: SlashCommandEntry) => void;
}

/**
 * Popup de autocompletar do composer (docs/26/27) — abre só quando `/` é o
 * primeiro caractere digitado (ver o `Suggestion` do Tiptap em Composer.tsx).
 * Duas colunas em vez de um tooltip flutuante por item: a descrição do item
 * selecionado/hover fica fixa na coluna da direita, sem reposicionar um
 * tooltip a cada seta pressionada — mais robusto que Radix Tooltip aqui, que
 * é pensado pra hover isolado, não pra navegação por teclado disparando o
 * mesmo efeito.
 */
export function SlashCommandMenu({ items, selectedIndex, onHover, onPick }: SlashCommandMenuProps) {
  if (items.length === 0) return null;
  const selected = items[selectedIndex];

  return (
    <div className="z-50 flex overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-lg">
      <ul className="max-h-56 w-44 shrink-0 overflow-y-auto border-r border-border p-1">
        {items.map((entry, index) => (
          <li key={entry.command}>
            <button
              type="button"
              onMouseEnter={() => onHover(index)}
              onClick={() => onPick(entry)}
              className={cn(
                "block w-full cursor-pointer truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                index === selectedIndex ? "bg-border text-primary" : "text-foreground hover:bg-border/60",
              )}
            >
              {entry.command}
            </button>
          </li>
        ))}
      </ul>
      <div className="w-48 shrink-0 p-2.5 text-xs text-muted-foreground">{selected?.description}</div>
    </div>
  );
}
