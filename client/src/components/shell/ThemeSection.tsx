import { useState } from "react";
import { Check, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { ThemeImportDialog, type ThemeDialogIntent } from "@/components/shell/ThemeImportDialog";
import { useThemes, useThemeSync } from "@/hooks/useThemes";
import { isBuiltinTheme } from "@/lib/builtinThemes";
import { resolveConnection } from "@/lib/connectionResolver";
import { addProfile, isTailnetProfile, type Profile } from "@/lib/profiles";
import { deleteTheme, updateProfileMeta } from "@/lib/relayClient";
import type { Theme } from "@/lib/theme";
import { resolveTheme } from "@/lib/themeApply";
import { customThemesForHost, profilesUsingTheme, resolveProfileTheme, setThemesForHost, themeStoreKey } from "@/lib/themes";
import { cn } from "@/lib/utils";

/**
 * Miniature of the app's own layout — sidebar strip, a surface, a message
 * bubble, an accent — rather than a row of loose swatches. The settings
 * dialog is scoped to one profile at a time, which is often *not* the
 * active one, and re-theming the whole app to preview another profile's
 * choice would be worse than useless. This is what stands in for that.
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

export function ThemeSection({
  scopedProfile,
  activeProfile,
  allProfiles,
}: {
  scopedProfile: Profile;
  /** The profile this app is actually connected to — used as the relay for
   * every request here whenever it shares the scoped profile's host. */
  activeProfile: Profile;
  allProfiles: Profile[];
}) {
  // For a direct profile, both registries this section touches are
  // host-wide files that any relay on the machine reads and writes: the
  // themes directory and profiles.json (see themeRegistry.ts /
  // profileRegistry.ts). Talking to the scoped profile's own relay would
  // mean a profile whose service is stopped can neither read the theme list
  // nor have its theme changed, even though its data is sitting in a file
  // another relay on the same host is already serving — so this falls back
  // to the active profile's relay, known to be reachable, whenever the two
  // genuinely share a host. Same reasoning as DangerZone's executor lookup,
  // for the opposite reason: there, another relay is required; here, it's
  // simply the one known to be reachable.
  //
  // A tailnet profile breaks the host comparison instead of satisfying it:
  // every tailnet profile reports the same "127.0.0.1" sidecar placeholder
  // (profileImport.ts) regardless of which sandbox it actually is, so
  // `activeProfile.host === scopedProfile.host` is always true for two of
  // them even though each is its own isolated sandbox with its own
  // registry — `themeStoreKey` already keys a tailnet profile's local
  // mirror by `id` for exactly this reason. The scoped profile is always
  // its own registry there; substituting the active one would silently
  // read/write a different sandbox's themes.
  const registry =
    !isTailnetProfile(scopedProfile) && activeProfile.host === scopedProfile.host ? activeProfile : scopedProfile;
  const { supported } = useThemeSync(registry);
  const { all } = useThemes(scopedProfile);
  const { theme: current, missing } = resolveProfileTheme(scopedProfile);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importSeed, setImportSeed] = useState<string | undefined>(undefined);
  const [importIntent, setImportIntent] = useState<ThemeDialogIntent>("import");
  const [pendingDelete, setPendingDelete] = useState<Theme | null>(null);

  async function selectTheme(theme: Theme): Promise<void> {
    if (theme.id === current.id && !missing) return;
    setBusy(true);
    setError(null);
    try {
      // The built-in is stored as "no theme" rather than as its id: that's
      // what makes it the fallback for a profile whose custom theme is gone.
      const themeId = isBuiltinTheme(theme.id) ? null : theme.id;
      const { host, port, token } = await resolveConnection(registry);
      await updateProfileMeta(host, port, scopedProfile.id, { themeId }, token);
      addProfile({ ...scopedProfile, themeId: themeId ?? undefined });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
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
      const { host, port, token } = await resolveConnection(registry);
      await deleteTheme(host, port, theme.id, token);
      const key = themeStoreKey(scopedProfile);
      setThemesForHost(key, customThemesForHost(key).filter((entry) => entry.id !== theme.id));
      setPendingDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const usedBy = pendingDelete ? profilesUsingTheme(allProfiles, scopedProfile, pendingDelete.id) : [];

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-medium">Tema</h3>
        <p className="text-xs text-muted-foreground">
          Vale para este perfil em todos os dispositivos. Temas adicionados ficam no servidor e podem
          ser usados por qualquer perfil dele.
        </p>
      </div>

      {missing && (
        <p className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
          O tema deste perfil ({scopedProfile.themeId}) não está mais no servidor — usando o padrão
          até ele voltar.
        </p>
      )}

      {!supported && (
        <p className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
          Não foi possível ler os temas de {registry.label} (servidor fora do ar ou relay antigo). A
          lista abaixo é a última conhecida, e mudanças não vão salvar até ele responder.
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        {all.map((theme) => (
          <ThemeRow
            key={theme.id}
            theme={theme}
            selected={theme.id === current.id && !missing}
            busy={busy}
            onSelect={() => void selectTheme(theme)}
            onEdit={isBuiltinTheme(theme.id) ? undefined : () => edit(theme)}
            onDuplicate={() => duplicate(theme)}
            onDelete={isBuiltinTheme(theme.id) ? undefined : () => setPendingDelete(theme)}
          />
        ))}
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
        profile={registry}
        initialJson={importSeed}
        intent={importIntent}
        onImported={(theme) => void selectTheme(theme)}
      />

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir o tema "{pendingDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {usedBy.length > 0
                ? `${String(usedBy.length)} perfil(is) usam este tema (${usedBy
                    .map((profile) => profile.label)
                    .join(", ")}) e voltam para o tema padrão. Se você adicionar o tema de novo, a escolha volta sozinha.`
                : "Some de todos os dispositivos que apontam para este servidor."}
            </AlertDialogDescription>
          </AlertDialogHeader>
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
