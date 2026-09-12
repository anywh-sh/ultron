import { useEffect, useState } from "react";
import { Folder, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FolderPickerDialog } from "@/components/chat/FolderPickerDialog";
import { DangerZone } from "@/components/settings/DangerZone";
import { SettingsRow, SettingsSectionHeading } from "@/components/settings/SettingsRow";
import { useDefaultPaths } from "@/hooks/useDefaultPaths";
import { useRevokedProfiles } from "@/hooks/useProfileRevoked";
import {
  DEFAULT_MODEL_PREFERENCE,
  useModelPreference,
  type ModelPreference,
  type ModelPreferenceMode,
} from "@/hooks/useModelPreference";
import { useDict } from "@/i18n";
import { getKnownModels, labelForModel } from "@/lib/modelCatalog";
import { profileBadge } from "@/lib/profileBadge";
import {
  addProfile,
  isTailnetProfile,
  PROFILE_COLOR_COUNT,
  profileColorClass,
  profileColorClassForIndex,
  type Profile,
} from "@/lib/profiles";
import { resolveConnection } from "@/lib/connectionResolver";
import { updateProfileMeta } from "@/lib/relayClient";
import { cn } from "@/lib/utils";

/** Small square button, the shape every choice in this page uses: the
 * segmented control, the model list, the "change folder" action. Selected
 * takes the accent surface rather than the accent itself — a page can hold
 * several of these at once and only the accent border should shout. */
function ChoiceButton({
  selected,
  onClick,
  children,
}: {
  selected?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "cursor-pointer border px-2.5 py-1 font-mono text-[11.5px] transition-colors",
        selected
          ? "border-primary bg-primary-soft text-primary-ink"
          : "border-border text-muted-foreground hover:border-text-faint hover:bg-surface-hover hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function HomeFolderControl({ profile }: { profile: Profile }) {
  const dict = useDict();
  const { paths, setDefaultPath, clearDefaultPath } = useDefaultPaths();
  const [pickerOpen, setPickerOpen] = useState(false);
  const path = paths[profile.id];

  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "max-w-[15rem] truncate border border-border bg-bg-chrome px-2.5 py-1 font-mono text-[11.5px]",
          path ? "text-muted-foreground" : "text-text-faint",
        )}
      >
        {path ?? dict.settings.profile.home.systemDefault}
      </span>
      {path && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={dict.settings.profile.home.useSystemDefault}
          onClick={() => clearDefaultPath(profile.id)}
        >
          <X className="size-3.5" />
        </Button>
      )}
      <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
        <Folder className="size-3.5" />
        {dict.settings.profile.home.change}
      </Button>

      <FolderPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        profile={profile}
        initialPath={path ?? ""}
        locked={false}
        onSelect={(next) => setDefaultPath(profile.id, next)}
        onFocusComposer={() => {}}
      />
    </div>
  );
}

/** The mode first, then — only when the mode is "always the same" — which
 * model that is. Two rows of small buttons rather than two selects: the
 * whole catalog is four to nine entries, and a list you can read at a
 * glance doesn't need to be opened first. */
function ModelControl({
  preference,
  onChange,
}: {
  preference: ModelPreference;
  onChange: (preference: ModelPreference) => void;
}) {
  const dict = useDict();
  const modes: { id: ModelPreferenceMode; label: string }[] = [
    { id: "lastUsed", label: dict.settings.profile.model.lastUsed },
    { id: "fixed", label: dict.settings.profile.model.fixed },
  ];

  return (
    <>
      <div className="flex gap-1.5">
        {modes.map((mode) => (
          <ChoiceButton
            key={mode.id}
            selected={preference.mode === mode.id}
            onClick={() => onChange({ ...preference, mode: mode.id })}
          >
            {mode.label}
          </ChoiceButton>
        ))}
      </div>
      {preference.mode === "fixed" && (
        <div className="flex max-w-[16rem] flex-wrap justify-end gap-1.5">
          {getKnownModels().map((choice) => (
            <ChoiceButton
              key={choice}
              selected={preference.fixedModel === choice}
              onClick={() => onChange({ ...preference, fixedModel: choice as ModelPreference["fixedModel"] })}
            >
              {labelForModel(choice)}
            </ChoiceButton>
          ))}
        </div>
      )}
    </>
  );
}

/** Name and colour, both of which propagate to this profile's other
 * devices through a `PATCH`, and both failing the same way — hence one
 * component with one error line under them. The name saves on a button
 * rather than on every keystroke: each save is a request, and half-typed
 * names would reach the other devices. */
function IdentityRows({ profile, effectiveColorIndex }: { profile: Profile; effectiveColorIndex: number }) {
  const dict = useDict();
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
      const { host, port, token } = await resolveConnection(profile);
      const updated = await updateProfileMeta(host, port, profile.id, patch, token);
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
    <>
      <SettingsRow title={dict.settings.profile.name.title} description={dict.settings.profile.name.description}>
        <div className="flex items-center gap-2">
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            className="w-56"
            spellCheck={false}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={saving || !label.trim() || label.trim() === profile.label}
            onClick={() => void handleSaveLabel()}
          >
            {saving ? dict.settings.profile.name.saving : dict.common.save}
          </Button>
        </div>
      </SettingsRow>

      <SettingsRow title={dict.settings.profile.color.title} description={dict.settings.profile.color.description}>
        <div className="flex items-center gap-1.5">
          {Array.from({ length: PROFILE_COLOR_COUNT }, (_, index) => (
            <button
              key={index}
              type="button"
              aria-label={dict.settings.profile.color.swatch.replace("{number}", String(index + 1))}
              onClick={() => void applyPatch({ colorIndex: index })}
              className={cn(
                "size-5 shrink-0 cursor-pointer outline outline-offset-2",
                profileColorClassForIndex(index),
                effectiveColorIndex === index ? "outline-foreground" : "outline-transparent",
              )}
            />
          ))}
        </div>
      </SettingsRow>

      {error && <p className="pt-3 text-sm text-destructive">{error}</p>}
    </>
  );
}

/**
 * Everything that belongs to one profile, on one page: where its
 * conversations start, which model they open with, how it is named and
 * coloured everywhere else in the app, and how to get rid of it.
 */
export function ProfileSettings({
  profile,
  allProfiles,
  effectiveColorIndex,
  onProfileRemoved,
}: {
  profile: Profile;
  allProfiles: Profile[];
  effectiveColorIndex: number;
  onProfileRemoved: (removedId: string) => void;
}) {
  const dict = useDict();
  const revoked = useRevokedProfiles();
  const { preferences, setPreference } = useModelPreference();
  const badge = profileBadge(profile, revoked, dict);

  return (
    <div className="flex flex-col">
      <header className="flex items-center gap-2.5 pt-5 pb-1.5">
        <span className={cn("inline-block size-3 shrink-0", profileColorClass(profile.id))} />
        <h2 className="truncate font-display text-lg font-bold tracking-[-0.02em] text-foreground">
          {profile.label}
        </h2>
        <Badge variant={badge.variant}>{badge.label}</Badge>
        <div className="flex-1" />
        {/* A tailnet profile's `host` is the sidecar placeholder every one of
            them shares, so it would say the same thing for all of them —
            worse than saying nothing. */}
        {!isTailnetProfile(profile) && (
          <span className="font-mono text-[11px] text-text-faint">
            {profile.host}:{profile.relayPort}
          </span>
        )}
      </header>

      <SettingsSectionHeading>{dict.settings.profile.sections.general}</SettingsSectionHeading>

      <SettingsRow title={dict.settings.profile.home.title} description={dict.settings.profile.home.description}>
        <HomeFolderControl profile={profile} />
      </SettingsRow>

      <SettingsRow title={dict.settings.profile.model.title} description={dict.settings.profile.model.description}>
        <ModelControl
          preference={preferences[profile.id] ?? DEFAULT_MODEL_PREFERENCE}
          onChange={(preference) => setPreference(profile.id, preference)}
        />
      </SettingsRow>

      <SettingsSectionHeading>{dict.settings.profile.sections.personalization}</SettingsSectionHeading>

      <IdentityRows profile={profile} effectiveColorIndex={effectiveColorIndex} />

      <DangerZone scopedProfile={profile} allProfiles={allProfiles} onProfileRemoved={onProfileRemoved} />
    </div>
  );
}
