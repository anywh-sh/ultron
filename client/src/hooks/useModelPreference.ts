import { useCallback, useEffect, useState } from "react";
import type { ModelChoice } from "@/lib/relayClient";

const PREFERENCE_STORAGE_KEY = "ultron:model-preference";
const LAST_MODEL_STORAGE_KEY = "ultron:last-model";

export type ModelPreferenceMode = "lastUsed" | "fixed";

/** Never "default" on purpose — the fixed model has to be a real model, not
 * a synonym for "don't choose anything" (see removal of the "Padrão"
 * option from `ModelButton`). No longer a closed union: the real catalog is
 * fetched from the CLI (`@/lib/modelCatalog`), see `SettingsDialog` for the
 * selector built from it. */
export type FixedModelChoice = Exclude<ModelChoice, "default">;

export interface ModelPreference {
  mode: ModelPreferenceMode;
  fixedModel: FixedModelChoice;
}

const VALID_MODES: ModelPreferenceMode[] = ["lastUsed", "fixed"];

export const DEFAULT_MODEL_PREFERENCE: ModelPreference = { mode: "lastUsed", fixedModel: "sonnet" };

type PreferenceMap = Record<string, ModelPreference>;
type LastModelMap = Record<string, ModelChoice>;

/** No membership check against the known catalog here on purpose — at the
 * time this runs (app cold start, before any relay connection reported the
 * real catalog back) a legitimately-stored value like "opusplan" would still
 * fail an `includes` check against the fallback list. Format sanity only,
 * same reasoning as the relay's `isSetModelMessage` (let the CLI be the
 * final arbiter of whether a model actually exists). */
function isModelPreference(value: unknown): value is ModelPreference {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    VALID_MODES.includes(candidate.mode as ModelPreferenceMode) &&
    typeof candidate.fixedModel === "string" &&
    candidate.fixedModel.length > 0
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
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, ModelChoice] => typeof entry[1] === "string" && entry[1].length > 0,
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
