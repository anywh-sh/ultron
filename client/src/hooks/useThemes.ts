import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { fetchThemes } from "@/lib/relayClient";
import type { Profile } from "@/lib/profiles";
import type { Theme } from "@/lib/theme";
import { applyTheme, cacheResolvedTheme } from "@/lib/themeApply";
import {
  customThemesForHost,
  getThemeStore,
  resolveProfileTheme,
  selectableThemes,
  setThemesForHost,
  subscribeThemes,
} from "@/lib/themes";

/** Reactive view of one host's catalog: the built-ins plus whatever that
 * host has registered. */
export function useThemes(host: string): { all: Theme[]; custom: Theme[] } {
  useSyncExternalStore(subscribeThemes, getThemeStore);
  return useMemo(() => ({ all: selectableThemes(host), custom: customThemesForHost(host) }), [host]);
}

/**
 * Mirrors `host`'s `GET /control/themes` into the local catalog, on mount
 * and whenever the app comes back to the foreground — deliberately the same
 * trigger and the same failure posture as `useProfileSync`: a failed fetch
 * only reports `supported: false` and never touches what's already stored,
 * so an unreachable host doesn't make its themes disappear mid-use.
 *
 * `supported` is false on a relay too old to have the route, which is what
 * the settings UI uses to explain that this host can't store custom themes
 * (the built-ins still work) instead of showing an empty list as if none
 * had been added yet.
 */
export function useThemeSync(profile: Profile): { supported: boolean } {
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    let cancelled = false;

    function sync(): void {
      fetchThemes(profile.host, profile.relayPort)
        .then((themes) => {
          if (cancelled) return;
          setThemesForHost(profile.host, themes);
          setSupported(true);
        })
        .catch(() => {
          if (!cancelled) setSupported(false);
        });
    }

    sync();

    function handleVisibilityChange(): void {
      if (document.visibilityState === "visible") sync();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [profile.host, profile.relayPort]);

  return { supported };
}

/**
 * Paints the active profile's theme and keeps the boot cache current.
 *
 * `useLayoutEffect` so the repaint lands in the same commit as the profile
 * switch — with a plain effect the new profile's first frame renders in the
 * previous profile's colors.
 */
export function useActiveTheme(profile: Profile): { theme: Theme; missing: boolean } {
  useSyncExternalStore(subscribeThemes, getThemeStore);
  const { theme, missing } = resolveProfileTheme(profile);

  useLayoutEffect(() => {
    const resolved = applyTheme(theme);
    cacheResolvedTheme(profile.id, resolved);
  }, [profile.id, theme]);

  return { theme, missing };
}
