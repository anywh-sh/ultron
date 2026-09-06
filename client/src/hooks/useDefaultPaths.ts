import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "ultron:default-paths";

type DefaultPaths = Record<string, string>;

function readDefaultPaths(): DefaultPaths {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

/** Standalone read (outside a React component) of a profile's default path
 * — used by `ChatPanel` at the moment a new tab receives its first
 * `cwd_state`, without needing to subscribe to the whole hook (which
 * re-renders on any change to any profile). */
export function getDefaultPath(profileId: string): string | undefined {
  return readDefaultPaths()[profileId];
}

/**
 * Path that a new conversation for a profile should open in, configured in
 * Settings. A single key holding all profiles together (unlike
 * `useRecentFolders`, which already receives a concrete `profileId`)
 * because the Settings screen always edits the whole list at once. Missing
 * entry = never configured, falls back to that profile's relay default
 * (`relay/src/paths.ts::defaultCwd`).
 */
export function useDefaultPaths() {
  const [paths, setPaths] = useState<DefaultPaths>(() => readDefaultPaths());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(paths));
  }, [paths]);

  const setDefaultPath = useCallback((profileId: string, path: string) => {
    setPaths((prev) => ({ ...prev, [profileId]: path }));
  }, []);

  const clearDefaultPath = useCallback((profileId: string) => {
    setPaths((prev) => {
      if (!(profileId in prev)) return prev;
      const next = { ...prev };
      delete next[profileId];
      return next;
    });
  }, []);

  return { paths, setDefaultPath, clearDefaultPath };
}
