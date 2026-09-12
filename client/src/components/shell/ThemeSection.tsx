import { useState } from "react";
import { Check, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ThemeImportDialog, type ThemeDialogIntent } from "@/components/shell/ThemeImportDialog";
import { useThemeCatalog, useThemeSync } from "@/hooks/useThemes";
import { isBuiltinTheme } from "@/lib/builtinThemes";
import { resolveConnection } from "@/lib/connectionResolver";
import type { Profile } from "@/lib/profiles";
import { deleteTheme } from "@/lib/relayClient";
import type { Theme } from "@/lib/theme";
import { resolveTheme } from "@/lib/themeApply";
import {
  customThemesForHost,
  resolveSelectedTheme,
  setSelectedThemeId,
  setThemesForHost,
  themeStoreKey,
} from "@/lib/themes";
import { cn } from "@/lib/utils";

/**
 * Miniature of the app's own layout — sidebar strip, a surface, a message
 * bubble, an accent — rather than a row of loose swatches: a theme is a
 * relationship between surfaces, and a row of squares says nothing about
 * how they sit together.
 */
function ThemePreview({ theme }: { theme: Theme }) {
  const { colors } = resolveTheme(theme);
  return (
    <div
      className="flex h-12 w-20 shrink-0 overflow-hidden rounded border"
      style={{ background: colors.background, borderColor: colors.border }}
    >
      <div className="h-full w-1/4" style={{ background: colors["bg-sidebar"] }} />
      <div className="flex flex-1 flex-col justify-center gap-1 p-1.5">
        <div className="h-1.5 w-full rounded-sm" style={{ background: colors["bubble-user"] }} />
        <div className="h-1 w-3/4 rounded-sm" style={{ background: colors["muted-foreground"] }} />
        <div className="h-1 w-1/3 rounded-sm" style={{ background: colors.primary }} />
      </div>
    </div>
  );
}

function ThemeRow({
  theme,
  selected,
  busy,
  onSelect,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  theme: Theme;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  /** Absent for a built-in, which has no file on the host to rewrite. */
  onEdit?: () => void;
  onDuplicate: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md border p-2",
        selected ? "border-primary" : "border-border",
      )}
    >
      <button
        type="button"
        disabled={busy}
        onClick={onSelect}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
      >
        <ThemePreview theme={theme} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm">{theme.name}</span>
          <span className="truncate text-xs text-muted-foreground">
            {isBuiltinTheme(theme.id) ? "Embutido" : theme.appearance === "light" ? "Claro" : "Escuro"}
          </span>
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-1">
        {selected && <Check className="size-4 text-primary" />}
        {onEdit && (
          <Button variant="ghost" size="icon-sm" aria-label={`Editar ${theme.name}`} onClick={onEdit}>
            <Pencil className="size-3.5" />
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" aria-label={`Duplicar ou exportar ${theme.name}`} onClick={onDuplicate}>
          <Copy className="size-3.5" />
        </Button>
        {onDelete && (
          <Button variant="ghost" size="icon-sm" aria-label={`Excluir ${theme.name}`} onClick={onDelete}>
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

/** JSON a person can hand-edit and re-import — every token spelled out,
 * including the ones the app would have derived, so what you get out of
 * "duplicate" is the theme you're actually looking at. */
function themeAsJson(theme: Theme, id: string, name: string): string {
  const resolved = resolveTheme(theme);
  return JSON.stringify(
    { version: 1, id, name, appearance: resolved.appearance, colors: resolved.colors, terminal: resolved.terminal },
    null,
    2,
  );
}

export function ThemeSection({ activeProfile }: { activeProfile: Profile }) {
  // One registry, not one per profile: a theme is a file on a machine, and
  // the only machine this device can reliably write to is the one it is
  // connected to right now. Themes mirrored from other hosts stay
  // selectable (the catalog is the union), they just can't be edited or
  // deleted from here — `storeKey` on each entry is what says which is which.
  const registryKey = themeStoreKey(activeProfile);
  const { supported } = useThemeSync(activeProfile);
  const catalog = useThemeCatalog(activeProfile);
  const { theme: current, missing } = resolveSelectedTheme();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importSeed, setImportSeed] = useState<string | undefined>(undefined);
  const [importIntent, setImportIntent] = useState<ThemeDialogIntent>("import");
  const [pendingDelete, setPendingDelete] = useState<Theme | null>(null);

  function selectTheme(theme: Theme): void {
    // The built-in is stored as "no theme" rather than as its id: that's
    // what makes it the fallback for a selection whose file is gone.
    setSelectedThemeId(isBuiltinTheme(theme.id) ? null : theme.id);
  }

  // Editing and duplicating are the same dialog: saving under the same id
  // overwrites the file (the relay treats create and update as one
  // operation), saving under a new one creates a second theme. The only
  // difference is which id/name the JSON arrives with.
  function edit(theme: Theme): void {
    setImportSeed(themeAsJson(theme, theme.id, theme.name));
    setImportIntent("edit");
    setImportOpen(true);
  }

  function duplicate(theme: Theme): void {
    const id = `${theme.id === "default" ? "meu-tema" : theme.id}-copia`.slice(0, 32);
    setImportSeed(themeAsJson(theme, id, `${theme.name} (cópia)`));
    setImportIntent("duplicate");
    setImportOpen(true);
  }

  async function confirmDelete(theme: Theme): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const { host, port, token } = await resolveConnection(activeProfile);
      await deleteTheme(host, port, theme.id, token);
      setThemesForHost(registryKey, customThemesForHost(registryKey).filter((entry) => entry.id !== theme.id));
      setPendingDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-medium">Tema</h3>
        <p className="text-xs text-muted-foreground">
          Vale para o app inteiro neste dispositivo. Temas adicionados ficam no servidor e podem ser
          usados por qualquer perfil dele.
        </p>
      </div>

      {missing && (
        <p className="border border-border px-3 py-2 text-xs text-muted-foreground">
          O tema escolhido não está mais no servidor — usando o padrão até ele voltar.
        </p>
      )}

      {!supported && (
        <p className="border border-border px-3 py-2 text-xs text-muted-foreground">
          Não foi possível ler os temas de {activeProfile.label} (servidor fora do ar ou relay
          antigo). A lista abaixo é a última conhecida, e mudanças não vão salvar até ele responder.
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        {catalog.map(({ theme, storeKey }) => {
          const local = storeKey === registryKey;
          return (
            <ThemeRow
              key={theme.id}
              theme={theme}
              selected={theme.id === current.id && !missing}
              busy={busy}
              onSelect={() => selectTheme(theme)}
              onEdit={local ? () => edit(theme) : undefined}
              onDuplicate={() => duplicate(theme)}
              onDelete={local ? () => setPendingDelete(theme) : undefined}
            />
          );
        })}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {supported && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => {
            setImportSeed(undefined);
            setImportIntent("import");
            setImportOpen(true);
          }}
        >
          <Plus className="size-3.5" />
          Adicionar tema
        </Button>
      )}

      <ThemeImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        profile={activeProfile}
        initialJson={importSeed}
        intent={importIntent}
        onImported={(theme) => selectTheme(theme)}
      />

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir o tema "{pendingDelete?.name}"?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogBody>
            <AlertDialogDescription>
              Some de todos os dispositivos que apontam para este servidor. Se for o tema em uso
              aqui, o app volta para o padrão — e se você adicionar o tema de novo, a escolha volta
              sozinha.
            </AlertDialogDescription>
          </AlertDialogBody>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                if (pendingDelete) void confirmDelete(pendingDelete);
              }}
            >
              {busy ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
