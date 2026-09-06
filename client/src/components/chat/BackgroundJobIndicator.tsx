import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatDurationLong } from "@/lib/utils";
import type { BackgroundJobSummary } from "@/lib/relayClient";

interface BackgroundJobIndicatorProps {
  jobs: BackgroundJobSummary[];
  /** Docs/32, Fase F — pede pro relay matar o job. Chamado só depois da
   * confirmação (`AlertDialog` abaixo, não `window.confirm`: o diálogo
   * nativo do WebView não é confiável em todas as plataformas — mesma
   * classe de problema documentada em `SessionDeleteMenu`). */
  onCancel: (id: string) => void;
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
 * mostra jobs `ultron-bg` observados agora nesta sessão (docs/32, Fase E) e
 * deixa cancelar (Fase F). Deliberadamente NÃO reaproveita o visual do
 * `TurnIndicator` (pontinhos + "Pensando…"): aquilo comunica "o assistente
 * está ocupado agora", mas um job em background é o oposto — o assistente
 * está ocioso, o composer continua liberado, só tem algo rodando sem
 * supervisão em paralelo. Confundir os dois sugeriria erradamente que não dá
 * pra mandar outra mensagem. Mesmo padrão de dropdown de
 * `WorkingDirectoryButton`/`ContextUsageButton`: `modal={false}` (WKWebView
 * no macOS, docs/24) + blur do trigger ao fechar.
 */
export function BackgroundJobIndicator({ jobs, onCancel }: BackgroundJobIndicatorProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [confirmTarget, setConfirmTarget] = useState<BackgroundJobSummary | "all" | null>(null);

  if (jobs.length === 0) return null;

  const label = jobs.length === 1 ? jobs[0].label : `${String(jobs.length)} jobs em background`;

  return (
    <>
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
          <div className="flex items-center justify-between gap-2 py-1 pr-2 pl-2">
            <DropdownMenuLabel className="p-0">Rodando em background</DropdownMenuLabel>
            {jobs.length > 1 ? (
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  setConfirmTarget("all");
                }}
                className="cursor-pointer text-[11px] text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
              >
                Cancelar todos
              </button>
            ) : null}
          </div>
          <DropdownMenuSeparator />
          <div className="flex flex-col gap-2 px-2 py-1.5">
            {jobs.map((job) => (
              <div key={job.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-foreground" title={job.label}>
                  {job.label}
                </span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <ElapsedTime startedAt={job.startedAt} />
                  <button
                    type="button"
                    aria-label={`Cancelar ${job.label}`}
                    title="Cancelar"
                    onClick={(event) => {
                      event.preventDefault();
                      setConfirmTarget(job);
                    }}
                    className="cursor-pointer rounded p-0.5 text-muted-foreground transition-colors hover:bg-border hover:text-destructive"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <DropdownMenuSeparator />
          <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
            Você é avisado automaticamente quando terminar.
          </p>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmTarget !== null} onOpenChange={(open) => !open && setConfirmTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTarget === "all" ? "Cancelar todos os jobs" : "Cancelar job em background"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmTarget === "all"
                ? `Cancelar os ${String(jobs.length)} jobs em background? Os processos são encerrados imediatamente — essa ação não pode ser desfeita.`
                : `Cancelar "${confirmTarget?.label}"? O processo é encerrado imediatamente — essa ação não pode ser desfeita.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmTarget === "all") {
                  for (const job of jobs) onCancel(job.id);
                } else if (confirmTarget) {
                  onCancel(confirmTarget.id);
                }
                setConfirmTarget(null);
              }}
            >
              {confirmTarget === "all" ? "Cancelar todos" : "Cancelar job"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
