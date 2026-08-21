import { useEffect, useState } from "react";
import { ChevronRight, Folder } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { listDirectories, type FsEntry } from "@/lib/fsBrowse";
import type { Profile } from "@/lib/profiles";
import { cn } from "@/lib/utils";

interface FolderPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: Profile;
  /** Pasta de onde o breadcrumb começa quando o modal abre — o cwd atual da
   * sessão (que já é "o padrão do app" quando o usuário nunca escolheu nada,
   * resolvido pelo relay — ver relay/src/paths.ts). */
  initialPath: string;
  /** Se a sessão travou entre o modal ter sido aberto e agora (corrida entre
   * dois dispositivos), fecha sozinho — ver efeito abaixo. */
  locked: boolean;
  onSelect: (path: string) => void;
}

interface Crumb {
  label: string;
  path: string;
}

/** `/home/user/mode/widgets` -> home > wil > mode > widgets, cada um com o path
 * acumulado até ali. Raiz vira um crumb estático "/". */
function breadcrumbsFor(path: string): Crumb[] {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return [{ label: "/", path: "/" }];
  let acc = "";
  return segments.map((label) => {
    acc += `/${label}`;
    return { label, path: acc };
  });
}

function parentOf(path: string): string {
  const segments = path.split("/").filter(Boolean);
  segments.pop();
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

/**
 * Modal de escolha de working directory — breadcrumb navegável + listagem de
 * subpastas (nunca arquivos) via `GET /fs/list` no relay (a máquina onde o
 * agente roda, não o dispositivo do cliente). Modelado no `Dialog`
 * controlado de `EditLinkDialog.tsx`; ao contrário daquele, este não vive
 * dentro do `<form>` do Composer (é renderizado a partir de
 * `WorkingDirectoryButton`, irmão do Composer em `ChatPanel`), então o
 * cuidado de `stopPropagation` de lá não se aplica aqui.
 */
export function FolderPickerDialog({
  open,
  onOpenChange,
  profile,
  initialPath,
  locked,
  onSelect,
}: FolderPickerDialogProps) {
  const [browsePath, setBrowsePath] = useState(initialPath);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  async function navigate(path?: string): Promise<boolean> {
    setLoading(true);
    try {
      const result = await listDirectories(profile, path);
      setBrowsePath(result.path);
      setEntries(result.entries);
      setError(null);
      setInitialLoadDone(true);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setInitialLoadDone(false);
    void (async () => {
      // Pasta salva pode ter sido apagada/ficado sem permissão desde a
      // última vez — se a navegação inicial falhar, tenta de novo pro
      // padrão do app em vez de deixar o modal sem nada navegável.
      const ok = await navigate(initialPath);
      if (!ok) void navigate(undefined);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && locked) onOpenChange(false);
  }, [open, locked, onOpenChange]);

  const crumbs = breadcrumbsFor(browsePath);
  const atRoot = browsePath === "/";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Selecionar pasta</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap pb-1 text-sm">
          {crumbs.map((crumb, index) => (
            <div key={crumb.path} className="flex shrink-0 items-center gap-1">
              {index > 0 && <ChevronRight className="size-3 shrink-0 text-muted-foreground" />}
              <button
                type="button"
                onClick={() => void navigate(crumb.path)}
                className="shrink-0 cursor-pointer rounded px-1 py-0.5 hover:bg-border"
              >
                {crumb.label}
              </button>
            </div>
          ))}
        </div>

        <ScrollArea className="h-64 rounded-md border border-border">
          <div className="flex flex-col p-1">
            {!atRoot && (
              <button
                type="button"
                onClick={() => void navigate(parentOf(browsePath))}
                className="flex shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-border"
              >
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                <span>..</span>
              </button>
            )}

            {loading && <div className="px-2 py-1.5 text-sm text-muted-foreground">Carregando…</div>}

            {!loading && error && <div className="px-2 py-1.5 text-sm text-destructive">{error}</div>}

            {!loading && !error && entries.length === 0 && (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">Nenhuma subpasta aqui.</div>
            )}

            {!loading &&
              !error &&
              entries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() => void navigate(entry.path)}
                  className={cn(
                    "flex shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-border",
                  )}
                >
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{entry.name}</span>
                </button>
              ))}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!initialLoadDone}
            onClick={() => {
              onSelect(browsePath);
              onOpenChange(false);
            }}
          >
            Selecionar pasta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
