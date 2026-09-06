import { useCallback, useEffect, useState } from "react";
import type { ModelChoice } from "@/lib/relayClient";

const PREFERENCE_STORAGE_KEY = "ultron:model-preference";
const LAST_MODEL_STORAGE_KEY = "ultron:last-model";

export type ModelPreferenceMode = "lastUsed" | "fixed";

/** Never "default" on purpose — the fixed model has to be a real model, not
 * a synonym for "don't choose anything" (see removal of the "Padrão"
 * option from `ModelButton`). */
export type FixedModelChoice = Exclude<ModelChoice, "default">;

export interface ModelPreference {
  mode: ModelPreferenceMode;
  fixedModel: FixedModelChoice;
}

const VALID_MODES: ModelPreferenceMode[] = ["lastUsed", "fixed"];
/** Same 4 options as `ModelButton` (no "default", see `FixedModelChoice`) —
 * exported for `SettingsDialog` to build the fixed model selector. */
export const FIXED_MODEL_CHOICES: FixedModelChoice[] = ["sonnet", "opus", "haiku", "fable"];
const VALID_MODELS: ModelChoice[] = ["default", ...FIXED_MODEL_CHOICES];

export const DEFAULT_MODEL_PREFERENCE: ModelPreference = { mode: "lastUsed", fixedModel: "sonnet" };

type PreferenceMap = Record<string, ModelPreference>;
type LastModelMap = Record<string, ModelChoice>;

function isModelPreference(value: unknown): value is ModelPreference {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    VALID_MODES.includes(candidate.mode as ModelPreferenceMode) &&
    FIXED_MODEL_CHOICES.includes(candidate.fixedModel as FixedModelChoice)
  );
}

function readPreferences(): PreferenceMap {
  try {
    const raw = localStorage.getItem(PREFERENCE_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, ModelPreference] => isModelPreference(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

function readLastModels(): LastModelMap {
  try {
    const raw = localStorage.getItem(LAST_MODEL_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, ModelChoice] =>
        VALID_MODELS.includes(entry[1] as ModelChoice),
      ),
    );
  } catch {
    return {};
  }
}

/**
 * Model that a new conversation for a profile should preselect, resolved
 * from the preference configured in Settings — standalone read (outside a
 * React component), same reasoning as `getDefaultPath`. "last used" mode
 * falls back to "sonnet" when the profile has no history yet (first-ever
 * use), since we only support Claude Code today and Sonnet is its
 * lowest-common-denominator default across profiles/accounts.
 */
export function getPreferredModel(profileId: string): ModelChoice {
  const preference = readPreferences()[profileId] ?? DEFAULT_MODEL_PREFERENCE;
  if (preference.mode === "fixed") return preference.fixedModel;
  return readLastModels()[profileId] ?? "sonnet";
}

/**
 * Records the last model used by a profile — called whenever a session's
 * `model` changes to a concrete value (`ChatPanel`), regardless of whether
 * it was the preselection itself, `ModelButton`, or a typed `/model`. Only
 * consumed by "lastUsed" mode, but always recorded: switching the mode back
 * to "lastUsed" later shouldn't lose what already ran in the meantime.
 */
export function setLastModel(profileId: string, model: ModelChoice): void {
  const current = readLastModels();
  if (current[profileId] === model) return;
  localStorage.setItem(LAST_MODEL_STORAGE_KEY, JSON.stringify({ ...current, [profileId]: model }));
}

/** Per-profile model preselection preference, configured in Settings —
 * same pattern as `useDefaultPaths` (single key with all profiles
 * together, the Settings screen always edits the whole list). */
export function useModelPreference() {
  const [preferences, setPreferences] = useState<PreferenceMap>(() => readPreferences());

  useEffect(() => {
    localStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(preferences));
  }, [preferences]);

  const setPreference = useCallback((profileId: string, preference: ModelPreference) => {
    setPreferences((prev) => ({ ...prev, [profileId]: preference }));
  }, []);

  return { preferences, setPreference };
}
