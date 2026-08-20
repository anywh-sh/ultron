import { cn } from "@/lib/utils";

interface SkeletonRow {
  align: "left" | "right";
  widths: string[];
}

const ROWS: SkeletonRow[] = [
  { align: "left", widths: ["w-56", "w-40"] },
  { align: "right", widths: ["w-32"] },
  { align: "left", widths: ["w-64", "w-48", "w-56"] },
  { align: "right", widths: ["w-40"] },
  { align: "left", widths: ["w-48"] },
];

/**
 * Fica no lugar do log enquanto a aba ainda não recebeu o marcador
 * `caught_up` do relay — a reconstrução do histórico a partir do `.jsonl`
 * (docs/20) trouxe uma espera real que antes não existia (o log sempre
 * chegava vazio na hora). Sem isso a tela fica com cara de travada: composer
 * desabilitado, log vazio, até o replay inteiro terminar de chegar.
 */
export function MessageLogSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-4 overflow-hidden px-4 py-3" role="status" aria-label="Carregando conversa…">
      {ROWS.map((row, i) => (
        <div key={i} className={cn("flex", row.align === "right" ? "justify-end" : "justify-start")} aria-hidden="true">
          <div className={cn("flex flex-col gap-1.5", row.align === "right" && "items-end")}>
            {row.widths.map((width, j) => (
              <div key={j} className={cn("h-3 animate-pulse rounded-full bg-border", width)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
