import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { fetchThemes } from "@/lib/relayClient";
import { resolveConnection } from "@/lib/connectionResolver";
import { useForegroundSync } from "@/hooks/useForegroundSync";
import type { Profile } from "@/lib/profiles";
import type { Theme } from "@/lib/theme";
import { applyTheme, cacheResolvedTheme, resolveTheme, type ResolvedTheme } from "@/lib/themeApply";
import {
  customThemesForHost,
  getThemeStore,
  resolveProfileTheme,
  selectableThemes,
  setThemesForHost,
  subscribeThemes,
  themeStoreKey,
} from "@/lib/themes";

/** Reactive view of one profile's catalog: the built-ins plus whatever its
 * registry (`themeStoreKey`) has registered.
 *
 * The store snapshot is a dependency, not just a subscription: the selectors
 * read the module-level store rather than taking it as an argument, so a memo
 * keyed only on the store key would keep handing back the previous list
 * after a theme is added — the component re-renders and shows stale content. */
export function useThemes(profile: Profile): { all: Theme[]; custom: Theme[] } {
  const store = useSyncExternalStore(subscribeThemes, getThemeStore);
  const key = themeStoreKey(profile);
  return useMemo(() => ({ all: selectableThemes(key), custom: customThemesForHost(key) }), [store, key]);
}

/**
 * Mirrors `profile`'s `GET /control/themes` into the local catalog on the
 * triggers `useForegroundSync` provides — deliberately the same triggers and
 * the same failure posture as `useProfileSync`: a failed fetch only reports
 * `supported: false` and never touches what's already stored, so an
 * unreachable host doesn't make its themes disappear mid-use.
 *
 * `supported` is false on a relay too old to have the route, which is what
 * the settings UI uses to explain that this host can't store custom themes
 * (the built-ins still work) instead of showing an empty list as if none
 * had been added yet.
 */
export function useThemeSync(profile: Profile): { supported: boolean } {
  const [supported, setSupported] = useState(true);
  // Guards against a response from the previous profile landing after a
  // switch — `profile.id` (not `host`) is what actually tells two profiles
  // apart, since every tailnet profile shares the same placeholder host.
  const currentProfileId = useRef(profile.id);
  currentProfileId.current = profile.id;

  const sync = useCallback(() => {
    const profileId = profile.id;
    const key = themeStoreKey(profile);
    resolveConnection(profile)
      .then(({ host, port, token }) => fetchThemes(host, port, token))
      .then((themes) => {
        if (currentProfileId.current !== profileId) return;
        setThemesForHost(key, themes);
        setSupported(true);
      })
      .catch(() => {
        if (currentProfileId.current === profileId) setSupported(false);
      });
  }, [
    profile.id,
    profile.host,
    profile.relayPort,
    profile.tailnetAuthKey,
    profile.tailnetControlUrl,
    profile.tailnetTarget,
    profile.brokerUrl,
    profile.brokerNodeId,
  ]);

  useForegroundSync(sync);

  return { supported };
}

/**
 * A profile's theme with every token filled in, without painting anything —
 * for consumers that need literal colors rather than CSS variables (xterm,
 * the preview miniature in settings).
 */
export function useResolvedProfileTheme(profile: Profile): ResolvedTheme {
  const store = useSyncExternalStore(subscribeThemes, getThemeStore);
  return useMemo(() => resolveTheme(resolveProfileTheme(profile).theme), [store, profile]);
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
