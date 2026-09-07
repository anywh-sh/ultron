import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { fetchThemes } from "@/lib/relayClient";
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
} from "@/lib/themes";

/** Reactive view of one host's catalog: the built-ins plus whatever that
 * host has registered.
 *
 * The store snapshot is a dependency, not just a subscription: the selectors
 * read the module-level store rather than taking it as an argument, so a memo
 * keyed only on `host` would keep handing back the previous list after a
 * theme is added — the component re-renders and shows stale content. */
export function useThemes(host: string): { all: Theme[]; custom: Theme[] } {
  const store = useSyncExternalStore(subscribeThemes, getThemeStore);
  return useMemo(() => ({ all: selectableThemes(host), custom: customThemesForHost(host) }), [store, host]);
}

/**
 * Mirrors `host`'s `GET /control/themes` into the local catalog on the
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
  const currentHost = useRef(profile.host);
  currentHost.current = profile.host;

  const sync = useCallback(() => {
    const host = profile.host;
    fetchThemes(host, profile.relayPort)
      .then((themes) => {
        if (currentHost.current !== host) return;
        setThemesForHost(host, themes);
        setSupported(true);
      })
      .catch(() => {
        if (currentHost.current === host) setSupported(false);
      });
  }, [profile.host, profile.relayPort]);

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
