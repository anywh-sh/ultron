import { useState } from "react";
import { Check, Copy, Plus, Trash2 } from "lucide-react";
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
import { ThemeImportDialog } from "@/components/shell/ThemeImportDialog";
import { useThemes, useThemeSync } from "@/hooks/useThemes";
import { isBuiltinTheme } from "@/lib/builtinThemes";
import { addProfile, type Profile } from "@/lib/profiles";
import { deleteTheme, updateProfileMeta } from "@/lib/relayClient";
import type { Theme } from "@/lib/theme";
import { resolveTheme } from "@/lib/themeApply";
import { customThemesForHost, profilesUsingTheme, resolveProfileTheme, setThemesForHost } from "@/lib/themes";
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
  onDuplicate,
  onDelete,
}: {
  theme: Theme;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
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
  allProfiles,
}: {
  scopedProfile: Profile;
  allProfiles: Profile[];
}) {
  const { supported } = useThemeSync(scopedProfile);
  const { all } = useThemes(scopedProfile.host);
  const { theme: current, missing } = resolveProfileTheme(scopedProfile);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importSeed, setImportSeed] = useState<string | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<Theme | null>(null);

  async function selectTheme(theme: Theme): Promise<void> {
    if (theme.id === current.id && !missing) return;
    setBusy(true);
    setError(null);
    try {
      // The built-in is stored as "no theme" rather than as its id: that's
      // what makes it the fallback for a profile whose custom theme is gone.
      const themeId = isBuiltinTheme(theme.id) ? null : theme.id;
      await updateProfileMeta(scopedProfile.host, scopedProfile.relayPort, scopedProfile.id, { themeId });
      addProfile({ ...scopedProfile, themeId: themeId ?? undefined });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function duplicate(theme: Theme): void {
    const id = `${theme.id === "default" ? "meu-tema" : theme.id}-copia`.slice(0, 32);
    setImportSeed(themeAsJson(theme, id, `${theme.name} (cópia)`));
    setImportOpen(true);
  }

  async function confirmDelete(theme: Theme): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await deleteTheme(scopedProfile.host, scopedProfile.relayPort, theme.id);
      setThemesForHost(
        scopedProfile.host,
        customThemesForHost(scopedProfile.host).filter((entry) => entry.id !== theme.id),
      );
      setPendingDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const usedBy = pendingDelete ? profilesUsingTheme(allProfiles, scopedProfile.host, pendingDelete.id) : [];

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
          Este servidor ainda não guarda temas personalizados (relay antigo). Só o tema embutido está
          disponível aqui.
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
        profile={scopedProfile}
        initialJson={importSeed}
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
