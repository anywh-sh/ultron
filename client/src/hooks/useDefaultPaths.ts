import { useCallback, useMemo, useSyncExternalStore } from "react";
import { readSettings, resolveSetting, subscribeSettings, writeSettings } from "@/lib/settings";

/** Standalone read (outside a React component) of a profile's default path
 * — used by `ChatPanel` at the moment a new tab receives its first
 * `cwd_state`, without needing to subscribe to the whole hook (which
 * re-renders on any change to any profile). */
export function getDefaultPath(profileId: string): string | undefined {
  return resolveSetting("defaultPath", profileId);
}

/**
 * Path that a new conversation for a profile should open in, configured in
 * Settings. Missing entry = never configured, falls back to the global
 * setting (if any) and then to that profile's relay default
 * (`relay/src/paths.ts::defaultCwd`).
 */
export function useDefaultPaths() {
  const store = useSyncExternalStore(subscribeSettings, readSettings);

  const paths = useMemo(() => {
    const result: Record<string, string> = {};
    for (const [profileId, settings] of Object.entries(store.byProfile)) {
      if (settings.defaultPath !== undefined) result[profileId] = settings.defaultPath;
    }
    return result;
  }, [store]);

  const setDefaultPath = useCallback((profileId: string, path: string) => {
    const current = readSettings();
    writeSettings({
      ...current,
      byProfile: {
        ...current.byProfile,
        [profileId]: { ...current.byProfile[profileId], defaultPath: path },
      },
    });
  }, []);

  const clearDefaultPath = useCallback((profileId: string) => {
    const current = readSettings();
    const existing = current.byProfile[profileId];
    if (!existing || existing.defaultPath === undefined) return;
    const next = { ...existing };
    delete next.defaultPath;
    writeSettings({ ...current, byProfile: { ...current.byProfile, [profileId]: next } });
  }, []);

  return { paths, setDefaultPath, clearDefaultPath };
}
