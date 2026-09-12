import { useCallback, useEffect, useState } from "react";

const MAX_RECENTS = 5;

function recentFoldersKey(profileId: string): string {
  return `anywh:recent-folders:${profileId}`;
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
 * MRU of folders picked in the working directory picker, up to 5, isolated
 * per profile — same per-profile localStorage convention
 * `useTabs.ts` already used before it became a general list.
 * Simpler than that hook because the caller (`WorkingDirectoryButton`)
 * always has a concrete, stable `profileId` at mount.
 */
export function useRecentFolders(profileId: string) {
  const [recents, setRecents] = useState<string[]>(() => readRecents(profileId));

  // Profile can change (a tab from another profile mounting this same
  // component by positional identity) — reloads from the right storage
  // when that happens, instead of keeping the previous profile's list.
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
