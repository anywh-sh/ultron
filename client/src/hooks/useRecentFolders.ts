import { useCallback, useEffect, useState } from "react";

const MAX_RECENTS = 5;

function recentFoldersKey(profileId: string): string {
  return `ultron:recent-folders:${profileId}`;
}

function readRecents(profileId: string): string[] {
  try {
    const raw = localStorage.getItem(recentFoldersKey(profileId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

/**
 * MRU de pastas escolhidas no picker de working directory, até 5, isolada
 * por perfil (docs da feature) — mesma convenção de localStorage por perfil
 * que `useTabs.ts` já usava antes de virar uma lista geral (docs/29). Mais
 * simples que aquele hook porque quem chama (`WorkingDirectoryButton`) sempre
 * tem um `profileId` concreto e estável no mount.
 */
export function useRecentFolders(profileId: string) {
  const [recents, setRecents] = useState<string[]>(() => readRecents(profileId));

  // Perfil pode trocar (aba de outro perfil montando este mesmo componente
  // por identidade de posição) — recarrega do storage certo quando isso
  // acontece, em vez de manter a lista do perfil anterior.
  useEffect(() => {
    setRecents(readRecents(profileId));
  }, [profileId]);

  useEffect(() => {
    localStorage.setItem(recentFoldersKey(profileId), JSON.stringify(recents));
  }, [profileId, recents]);

  const addRecent = useCallback((path: string) => {
    setRecents((prev) => [path, ...prev.filter((p) => p !== path)].slice(0, MAX_RECENTS));
  }, []);

  return { recents, addRecent };
}
