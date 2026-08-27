import { useRef, useState } from "react";
import { Check, Copy, Folder } from "lucide-react";
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
  /** Aba aberta via "nova conversa" — a pasta é sempre escolhível de
   * imediato aqui (a sessão nunca nasce travada), então o botão não espera
   * a conexão WS abrir nem o primeiro `cwd_state` chegar: listar pastas é
   * uma chamada REST própria (`GET /fs/list`, sem `path` resolve pro padrão
   * do perfil) e a escolha em si fica pendurada no RelayClient até a
   * conexão abrir (ver relayClient.ts). Sessão existente continua exigindo
   * conexão — errar pro lado seguro evita destravar uma pasta que na
   * verdade já está travada, só ainda não confirmamos isso. */
  isNewConversation?: boolean;
  onSetCwd: (path: string) => void;
  /** Devolve o foco pro composer quando o dropdown ou o `FolderPickerDialog`
   * fecham — sem isso o Radix restaura o foco pro trigger deste botão por
   * padrão (`onCloseAutoFocus`), então escolher uma pasta deixava o usuário
   * sem poder digitar de cara, tendo que clicar no campo de novo. */
  onFocusComposer: () => void;
}

/** Nome só da última pasta do path, pro botão/lista não ficarem gigantes — o
 * path completo aparece no tooltip e no dropdown "Working directory". */
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
export function WorkingDirectoryButton({
  profile,
  cwd,
  locked,
  connected,
  isNewConversation,
  onSetCwd,
  onFocusComposer,
}: WorkingDirectoryButtonProps) {
  const { recents, addRecent } = useRecentFolders(profile.id);
  const [pickerOpen, setPickerOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

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
      <DropdownMenu
        // Radix trava foco + `pointer-events: none` no body enquanto o menu
        // modal está aberto, e restaura os dois ao fechar — no WKWebView
        // (Tauri no macOS) essa restauração falha justo quando a lista
        // "Recente" reordena entre uma abertura e outra (item escolhido sobe
        // pro topo, muda as keys de posição): a próxima abertura perde a
        // seção inteira, sobrando só "Escolher pasta...". `modal={false}`
        // tira esse mecanismo do caminho (não precisamos de focus trap aqui).
        modal={false}
        onOpenChange={(open) => {
          // Sem isso o foco fica no trigger depois do menu fechar, e como o
          // Tooltip também abre por foco (não só hover), ele fica "preso"
          // aberto até o mouse sair e voltar — mesmo já longe do botão.
          if (!open) triggerRef.current?.blur();
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                ref={triggerRef}
                type="button"
                disabled={!isNewConversation && (!cwd || !connected)}
                className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-bg-elevated px-2 text-xs text-foreground transition-colors hover:bg-border disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="max-w-56 truncate font-mono">{cwd ? folderName(cwd) : "…"}</span>
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">{cwd ?? (isNewConversation ? "Escolher pasta" : "Conectando…")}</TooltipContent>
        </Tooltip>

        <DropdownMenuContent
          align="start"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onFocusComposer();
          }}
        >
          {locked ? (
            <>
              <DropdownMenuLabel className="flex flex-col gap-0.5">
                <span>Working directory</span>
                <span className="truncate font-mono text-xs text-foreground">{cwd}</span>
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
                  <DropdownMenuItem key={path} title={path} onSelect={() => selectFolder(path)}>
                    <Check className={cn("size-3.5", path !== cwd && "opacity-0")} />
                    <span className="truncate">{folderName(path)}</span>
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
        onFocusComposer={onFocusComposer}
      />
    </>
  );
}
