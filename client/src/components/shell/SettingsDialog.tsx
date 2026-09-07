import { useEffect, useState } from "react";
import { Folder, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FolderPickerDialog } from "@/components/chat/FolderPickerDialog";
import { useDefaultPaths } from "@/hooks/useDefaultPaths";
import {
  DEFAULT_MODEL_PREFERENCE,
  useModelPreference,
  type ModelPreference,
  type ModelPreferenceMode,
} from "@/hooks/useModelPreference";
import { getKnownModels, labelForModel } from "@/lib/modelCatalog";
import type { Profile } from "@/lib/profiles";
import { useProfiles } from "@/hooks/useProfiles";
import { cn } from "@/lib/utils";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeProfile: Profile;
}

/** No real navigation yet (only "Geral" exists) — the list already exists
 * so the dialog's structure won't need to change when the second section
 * shows up. */
type Section = "geral";

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

  const scopedProfile = profiles.find((profile) => profile.id === scopedProfileId) ?? activeProfile;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle>Configurações</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-96">
          <div className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-border bg-bg-sidebar p-2">
            <button
              type="button"
              onClick={() => setSection("geral")}
              className={cn(
                "cursor-pointer rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                section === "geral" ? "bg-bg-elevated text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Geral
            </button>
          </div>

          <div className="flex-1 bg-bg-elevated p-4">
            {section === "geral" && (
              <div className="flex flex-col gap-3">
                <div>
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
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
