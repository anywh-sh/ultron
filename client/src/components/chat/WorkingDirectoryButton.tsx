import { useState } from "react";
import { Check, ChevronDown, Copy, Folder } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useRecentFolders } from "@/hooks/useRecentFolders";
import { FolderPickerDialog } from "@/components/chat/FolderPickerDialog";
import type { Profile } from "@/lib/profiles";
import { cn } from "@/lib/utils";

interface WorkingDirectoryButtonProps {
  profile: Profile;
  cwd: string | null;
  locked: boolean;
  connected: boolean;
  onSetCwd: (path: string) => void;
}

/** Nome só da última pasta do path, pro botão não ficar gigante — o path
 * completo aparece no tooltip e nos itens do dropdown. */
function folderName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const lastSegment = trimmed.split("/").pop();
  return lastSegment || "/";
}

/**
 * Botão sempre visível acima do `Composer`, mostrando (e deixando trocar) o
 * working directory da sessão atual. Antes do primeiro turno, o dropdown
 * lista "Recente" (por perfil, `useRecentFolders`) + "Escolher pasta...".
 * Depois do primeiro turno o relay trava a pasta (ver `SharedSession.runTurn`
 * — session_id do Claude Code fica amarrado ao cwd usado no spawn), então o
 * dropdown vira só visualização + "Copy path".
 */
export function WorkingDirectoryButton({ profile, cwd, locked, connected, onSetCwd }: WorkingDirectoryButtonProps) {
  const { recents, addRecent } = useRecentFolders(profile.id);
  const [pickerOpen, setPickerOpen] = useState(false);

  function selectFolder(path: string): void {
    onSetCwd(path);
    addRecent(path);
  }

  async function copyPath(): Promise<void> {
    if (!cwd) return;
    try {
      await navigator.clipboard.writeText(cwd);
    } catch {
      window.alert("Não foi possível copiar o caminho.");
    }
  }

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={!cwd || !connected}
                className={cn(
                  "flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-border disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                <Folder className="size-3.5 shrink-0" />
                <span className="max-w-56 truncate font-mono">{cwd ? folderName(cwd) : "…"}</span>
                <ChevronDown className="size-3 shrink-0" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">{cwd ?? "Conectando…"}</TooltipContent>
        </Tooltip>

        <DropdownMenuContent align="start">
          {locked ? (
            <>
              <DropdownMenuLabel className="flex flex-col gap-0.5">
                <span>Working directory</span>
                <span className="font-mono text-[11px] font-normal break-all text-muted-foreground">{cwd}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void copyPath()}>
                <Copy className="size-3.5" />
                Copy path
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuLabel>Recente</DropdownMenuLabel>
              {recents.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhuma pasta recente</div>
              ) : (
                recents.map((path) => (
                  <DropdownMenuItem key={path} onSelect={() => selectFolder(path)}>
                    <Check className={cn("size-3.5", path !== cwd && "opacity-0")} />
                    <span className="truncate font-mono">{path}</span>
                  </DropdownMenuItem>
                ))
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setPickerOpen(true)}>Escolher pasta...</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <FolderPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        profile={profile}
        initialPath={cwd ?? ""}
        locked={locked}
        onSelect={selectFolder}
      />
    </>
  );
}
