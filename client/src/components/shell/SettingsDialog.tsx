import { useState } from "react";
import { Folder, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FolderPickerDialog } from "@/components/chat/FolderPickerDialog";
import { useDefaultPaths } from "@/hooks/useDefaultPaths";
import {
  DEFAULT_MODEL_PREFERENCE,
  FIXED_MODEL_CHOICES,
  useModelPreference,
  type ModelPreference,
  type ModelPreferenceMode,
} from "@/hooks/useModelPreference";
import { MODEL_LABELS } from "@/components/chat/ModelButton";
import { PROFILES, type Profile } from "@/lib/profiles";
import { cn } from "@/lib/utils";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Nenhuma navegação real ainda (só existe "Geral") — a lista já existe pra
 * não precisar mudar a estrutura do dialog quando a segunda seção aparecer. */
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
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{profile.label}</span>
        <span className={cn("truncate font-mono text-xs", path ? "text-foreground" : "text-muted-foreground")}>
          {path ?? "Padrão do sistema"}
        </span>
      </div>
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
  profile,
  preference,
  onChange,
}: {
  profile: Profile;
  preference: ModelPreference;
  onChange: (preference: ModelPreference) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
      <span className="text-sm font-medium">{profile.label}</span>
      <div className="flex shrink-0 items-center gap-2">
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
              {FIXED_MODEL_CHOICES.map((choice) => (
                <SelectItem key={choice} value={choice}>
                  {MODEL_LABELS[choice]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}

/**
 * Dialog de configurações do app — aberto pelo menu na `TitleBar`. Layout de
 * dois painéis (padrão comum em apps desktop de configuração): nav escura à
 * esquerda, conteúdo mais claro à direita, separados por borda — só "Geral"
 * por enquanto, com o path inicial de cada perfil (`useDefaultPaths`).
 */
export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [section, setSection] = useState<Section>("geral");
  const { paths, setDefaultPath, clearDefaultPath } = useDefaultPaths();
  const { preferences, setPreference } = useModelPreference();

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
                  <h3 className="text-sm font-medium">Pasta inicial</h3>
                  <p className="text-xs text-muted-foreground">
                    Pasta em que uma conversa nova de cada perfil começa.
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  {PROFILES.map((profile) => (
                    <ProfilePathRow
                      key={profile.id}
                      profile={profile}
                      path={paths[profile.id]}
                      onSelect={(path) => setDefaultPath(profile.id, path)}
                      onClear={() => clearDefaultPath(profile.id)}
                    />
                  ))}
                </div>

                <div>
                  <h3 className="text-sm font-medium">Modelo padrão</h3>
                  <p className="text-xs text-muted-foreground">
                    Modelo pré-selecionado quando uma conversa nova de cada perfil começa.
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  {PROFILES.map((profile) => (
                    <ProfileModelRow
                      key={profile.id}
                      profile={profile}
                      preference={preferences[profile.id] ?? DEFAULT_MODEL_PREFERENCE}
                      onChange={(preference) => setPreference(profile.id, preference)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
