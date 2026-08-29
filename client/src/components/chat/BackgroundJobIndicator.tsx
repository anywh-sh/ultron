import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDurationLong } from "@/lib/utils";
import type { BackgroundJobSummary } from "@/lib/relayClient";

interface BackgroundJobIndicatorProps {
  jobs: BackgroundJobSummary[];
}

function ElapsedTime({ startedAt }: { startedAt: number }) {
  const [elapsedSeconds, setElapsedSeconds] = useState(() => Math.floor((Date.now() - startedAt) / 1000));

  useEffect(() => {
    const tick = () => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return <span className="font-mono text-xs whitespace-nowrap text-foreground">{formatDurationLong(elapsedSeconds)}</span>;
}

/**
 * Chip discreto acima do composer, ao lado do `WorkingDirectoryButton` —
 * mostra jobs `ultron-bg` observados agora nesta sessão (docs/32, Fase E).
 * Deliberadamente NÃO reaproveita o visual do `TurnIndicator` (pontinhos +
 * "Pensando…"): aquilo comunica "o assistente está ocupado agora", mas um
 * job em background é o oposto — o assistente está ocioso, o composer
 * continua liberado, só tem algo rodando sem supervisão em paralelo.
 * Confundir os dois sugeriria erradamente que não dá pra mandar outra
 * mensagem. Mesmo padrão de dropdown de `WorkingDirectoryButton`/
 * `ContextUsageButton`: `modal={false}` (WKWebView no macOS, docs/24) +
 * blur do trigger ao fechar.
 */
export function BackgroundJobIndicator({ jobs }: BackgroundJobIndicatorProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  if (jobs.length === 0) return null;

  const label = jobs.length === 1 ? jobs[0].label : `${String(jobs.length)} jobs em background`;

  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => {
        if (!open) triggerRef.current?.blur();
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-label={`${String(jobs.length)} job(s) em background`}
          className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-bg-elevated px-2 text-xs text-foreground transition-colors hover:bg-border"
        >
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
          <span className="max-w-40 truncate font-mono">{label}</span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Rodando em background</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="flex flex-col gap-2 px-2 py-1.5">
          {jobs.map((job) => (
            <div key={job.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-xs text-foreground" title={job.label}>
                {job.label}
              </span>
              <ElapsedTime startedAt={job.startedAt} />
            </div>
          ))}
        </div>
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
          Você é avisado automaticamente quando terminar.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
