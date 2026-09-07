import { useEffect, useState } from "react";
import { Folder, X } from "lucide-react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FolderPickerDialog } from "@/components/chat/FolderPickerDialog";
import { ThemeSection } from "@/components/shell/ThemeSection";
import { useDefaultPaths } from "@/hooks/useDefaultPaths";
import {
  DEFAULT_MODEL_PREFERENCE,
  useModelPreference,
  type ModelPreference,
  type ModelPreferenceMode,
} from "@/hooks/useModelPreference";
import { getKnownModels, labelForModel } from "@/lib/modelCatalog";
import { addProfile, PROFILE_COLOR_COUNT, profileColorClassForIndex, removeProfile, type Profile } from "@/lib/profiles";
import { deleteProfile, updateProfileMeta } from "@/lib/relayClient";
import { useProfiles } from "@/hooks/useProfiles";
import { cn } from "@/lib/utils";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeProfile: Profile;
}

type Section = "geral" | "personalizacao";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "geral", label: "Geral" },
  { id: "personalizacao", label: "Personalização" },
];

function ProfilePathRow({
  profile,
  path,
  onSelect,
  onClear,
}: {
  profile: Profile;
  path: string | undefined;
  onSelect: (path: string) => void;
  onClear: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
      <span className={cn("min-w-0 truncate font-mono text-xs", path ? "text-foreground" : "text-muted-foreground")}>
        {path ?? "Padrão do sistema"}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        {path && (
          <Button variant="ghost" size="icon-sm" aria-label="Usar padrão do sistema" onClick={onClear}>
            <X className="size-3.5" />
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
          <Folder className="size-3.5" />
          Alterar
        </Button>
      </div>

      <FolderPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        profile={profile}
        initialPath={path ?? ""}
        locked={false}
        onSelect={onSelect}
        onFocusComposer={() => {}}
      />
    </div>
  );
}

function ProfileModelRow({
  preference,
  onChange,
}: {
  preference: ModelPreference;
  onChange: (preference: ModelPreference) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
      <Select
        value={preference.mode}
        onValueChange={(mode) => onChange({ ...preference, mode: mode as ModelPreferenceMode })}
      >
        <SelectTrigger size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="lastUsed">Último usado</SelectItem>
          <SelectItem value="fixed">Sempre o mesmo</SelectItem>
        </SelectContent>
      </Select>

      {preference.mode === "fixed" && (
        <Select
          value={preference.fixedModel}
          onValueChange={(fixedModel) => onChange({ ...preference, fixedModel: fixedModel as ModelPreference["fixedModel"] })}
        >
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {getKnownModels().map((choice) => (
              <SelectItem key={choice} value={choice}>
                {labelForModel(choice)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

/** Name (propagates to other devices via `PATCH`) + color swatches for the
 * scoped profile. `effectiveColorIndex` (not `profile.colorIndex` directly)
 * so the currently-highlighted swatch matches what `profileColorClass`
 * actually renders elsewhere for a profile that predates the field. */
function ProfileIdentityRow({ profile, effectiveColorIndex }: { profile: Profile; effectiveColorIndex: number }) {
  const [label, setLabel] = useState(profile.label);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLabel(profile.label);
    setError(null);
  }, [profile.id, profile.label]);

  async function applyPatch(patch: { label?: string; colorIndex?: number }): Promise<void> {
    setError(null);
    try {
      const updated = await updateProfileMeta(profile.host, profile.relayPort, profile.id, patch);
      addProfile({ ...profile, label: updated.label, colorIndex: updated.colorIndex });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSaveLabel(): Promise<void> {
    const trimmed = label.trim();
    if (!trimmed || trimmed === profile.label) return;
    setSaving(true);
    await applyPatch({ label: trimmed });
    setSaving(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-ring"
        />
        <Button
          variant="outline"
          size="sm"
          disabled={saving || !label.trim() || label.trim() === profile.label}
          onClick={() => void handleSaveLabel()}
        >
          {saving ? "Salvando…" : "Salvar"}
        </Button>
      </div>
      <div className="flex items-center gap-1.5">
        {Array.from({ length: PROFILE_COLOR_COUNT }, (_, index) => (
          <button
            key={index}
            type="button"
            aria-label={`Cor ${String(index + 1)}`}
            onClick={() => void applyPatch({ colorIndex: index })}
            className={cn(
              "size-5 shrink-0 cursor-pointer rounded-full outline outline-offset-2",
              profileColorClassForIndex(index),
              effectiveColorIndex === index ? "outline-foreground" : "outline-transparent",
            )}
          />
        ))}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function DangerZone({
  scopedProfile,
  allProfiles,
  onProfileRemoved,
}: {
  scopedProfile: Profile;
  allProfiles: Profile[];
  onProfileRemoved: (removedId: string) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A different relay on the same host executes the deletion — sending it
  // to the profile's own relay would make it disable its own systemd
  // instance mid-request (docs/45 Fase 6).
  const executor = allProfiles.find((p) => p.id !== scopedProfile.id && p.host === scopedProfile.host);

  async function handleDeleteFromServer(): Promise<void> {
    if (!executor) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteProfile(executor.host, executor.relayPort, scopedProfile.id);
      // Optimistic local removal for immediate feedback on this device —
      // `useActiveProfile`'s own reactive fallback handles switching away if
      // this happened to be the active profile, and every other device
      // picks up the removal on its next profile sync (useProfileSync).
      removeProfile(scopedProfile.id);
      onProfileRemoved(scopedProfile.id);
      setConfirmOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-destructive/40 p-3">
      <h3 className="text-sm font-medium text-destructive">Zona de risco</h3>

      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm">Excluir do servidor</span>
          <span className="text-xs text-muted-foreground">
            {executor
              ? "Some de todos os dispositivos — a conta e o histórico continuam no host."
              : "Precisa de outro perfil no mesmo host pra executar a exclusão."}
          </span>
        </div>
        <Button variant="destructive" size="sm" disabled={!executor} onClick={() => setConfirmOpen(true)}>
          Excluir
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir perfil "{scopedProfile.label}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove esse perfil de todos os dispositivos que apontam pra esse host. A conta Claude e
              o histórico de conversas continuam intactos na máquina.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteFromServer();
              }}
            >
              {deleting ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * App settings dialog — opened from the `TitleBar` menu. Two-panel layout
 * (common pattern in desktop settings apps): dark nav on the left, lighter
 * content on the right, separated by a border — only "Geral" for now,
 * scoped to one profile at a time (`scopedProfileId`) via the selector at
 * the top, instead of listing every profile's row at once. Reset to
 * `activeProfile` whenever the dialog opens, so reopening after switching
 * profiles in the main UI lands on the profile you're actually looking at.
 */
export function SettingsDialog({ open, onOpenChange, activeProfile }: SettingsDialogProps) {
  const [section, setSection] = useState<Section>("geral");
  const profiles = useProfiles();
  const [scopedProfileId, setScopedProfileId] = useState(activeProfile.id);
  const { paths, setDefaultPath, clearDefaultPath } = useDefaultPaths();
  const { preferences, setPreference } = useModelPreference();

  useEffect(() => {
    if (open) setScopedProfileId(activeProfile.id);
  }, [open, activeProfile.id]);

  const scopedProfileIndex = profiles.findIndex((profile) => profile.id === scopedProfileId);
  const scopedProfile = scopedProfileIndex >= 0 ? profiles[scopedProfileIndex] : activeProfile;
  const effectiveColorIndex = scopedProfile.colorIndex ?? Math.max(scopedProfileIndex, 0);

  function handleProfileRemoved(removedId: string): void {
    setScopedProfileId((current) => {
      if (current !== removedId) return current;
      const fallback = profiles.find((profile) => profile.id !== removedId);
      return fallback ? fallback.id : current;
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle>Configurações</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-96">
          <div className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-border bg-bg-sidebar p-2">
            {SECTIONS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setSection(entry.id)}
                className={cn(
                  "cursor-pointer rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                  section === entry.id
                    ? "bg-bg-elevated text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto bg-bg-elevated p-4">
            {/* Every setting in this dialog belongs to one profile, so the
                scoping selector sits above the sections instead of being
                repeated inside each one. */}
            <div className="mb-3">
              <h3 className="text-sm font-medium">Perfil</h3>
              <Select value={scopedProfileId} onValueChange={setScopedProfileId}>
                <SelectTrigger size="sm" className="mt-1.5 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {section === "personalizacao" && (
              <div className="flex flex-col gap-3">
                <div>
                  <h3 className="text-sm font-medium">Identificação</h3>
                  <p className="text-xs text-muted-foreground">Nome e cor deste perfil no seletor.</p>
                </div>
                <ProfileIdentityRow profile={scopedProfile} effectiveColorIndex={effectiveColorIndex} />
                <ThemeSection scopedProfile={scopedProfile} allProfiles={profiles} />
              </div>
            )}

            {section === "geral" && (
              <div className="flex flex-col gap-3">
                <div>
                  <h3 className="text-sm font-medium">Pasta inicial</h3>
                  <p className="text-xs text-muted-foreground">Pasta em que uma conversa nova deste perfil começa.</p>
                </div>
                <ProfilePathRow
                  profile={scopedProfile}
                  path={paths[scopedProfile.id]}
                  onSelect={(path) => setDefaultPath(scopedProfile.id, path)}
                  onClear={() => clearDefaultPath(scopedProfile.id)}
                />

                <div>
                  <h3 className="text-sm font-medium">Modelo padrão</h3>
                  <p className="text-xs text-muted-foreground">
                    Modelo pré-selecionado quando uma conversa nova deste perfil começa.
                  </p>
                </div>
                <ProfileModelRow
                  preference={preferences[scopedProfile.id] ?? DEFAULT_MODEL_PREFERENCE}
                  onChange={(preference) => setPreference(scopedProfile.id, preference)}
                />

                <DangerZone scopedProfile={scopedProfile} allProfiles={profiles} onProfileRemoved={handleProfileRemoved} />
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
