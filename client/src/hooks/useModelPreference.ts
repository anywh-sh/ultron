import { useCallback, useEffect, useState } from "react";
import type { ModelChoice } from "@/lib/relayClient";

const PREFERENCE_STORAGE_KEY = "ultron:model-preference";
const LAST_MODEL_STORAGE_KEY = "ultron:last-model";

export type ModelPreferenceMode = "lastUsed" | "fixed";

/** Nunca "default" de propósito — o modelo fixo tem que ser um modelo de
 * verdade, não um sinônimo de "não escolher nada" (ver remoção da opção
 * "Padrão" do `ModelButton`). */
export type FixedModelChoice = Exclude<ModelChoice, "default">;

export interface ModelPreference {
  mode: ModelPreferenceMode;
  fixedModel: FixedModelChoice;
}

const VALID_MODES: ModelPreferenceMode[] = ["lastUsed", "fixed"];
/** Mesmas 4 opções do `ModelButton` (sem "default", ver `FixedModelChoice`) —
 * exportado pra `SettingsDialog` montar o seletor de modelo fixo. */
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
 * Modelo que uma conversa nova de um perfil deve pré-selecionar, resolvido a
 * partir da preferência configurada em Configurações — leitura avulsa (fora
 * de componente React), mesmo raciocínio de `getDefaultPath`. `undefined` =
 * nada pra aplicar (modo "último usado" sem nenhum histórico ainda pra esse
 * perfil), deixa a CLI cair no próprio default da conta.
 */
export function getPreferredModel(profileId: string): ModelChoice | undefined {
  const preference = readPreferences()[profileId] ?? DEFAULT_MODEL_PREFERENCE;
  if (preference.mode === "fixed") return preference.fixedModel;
  return readLastModels()[profileId];
}

/**
 * Grava o último modelo usado por um perfil — chamado sempre que o `model`
 * de uma sessão muda pra um valor concreto (`ChatPanel`), independente de ter
 * sido a própria pré-seleção, o `ModelButton` ou `/model` digitado. Só
 * consumido pelo modo "lastUsed", mas grava sempre: trocar o modo de volta
 * pra "lastUsed" depois não deve perder o que já rodou nesse meio tempo.
 */
export function setLastModel(profileId: string, model: ModelChoice): void {
  const current = readLastModels();
  if (current[profileId] === model) return;
  localStorage.setItem(LAST_MODEL_STORAGE_KEY, JSON.stringify({ ...current, [profileId]: model }));
}

/** Preferência de pré-seleção de modelo por perfil, configurada em
 * Configurações — mesmo padrão de `useDefaultPaths` (chave única com todos os
 * perfis juntos, a tela de Configurações sempre edita a lista inteira). */
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
