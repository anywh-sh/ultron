import { BUILTIN_THEMES, DEFAULT_THEME } from "@/lib/builtinThemes";
import { isTailnetProfile, type Profile } from "@/lib/profiles";
import type { Theme } from "@/lib/theme";

/** The key a profile's theme registry is stored/looked up under. Normally
 * `profile.host` — a registry belongs to the machine that stores it, and two
 * profiles on the same real host share the same file. A tailnet profile
 * breaks that: every one of them has `host` set to the same
 * `127.0.0.1` sidecar placeholder (`profileImport.ts`), so keying by host
 * would make two unrelated tailnet profiles' custom themes collide — `id` is
 * the only field that actually tells them apart. */
export function themeStoreKey(profile: Profile): string {
  return isTailnetProfile(profile) ? profile.id : profile.host;
}

/**
 * Local mirror of each host's theme registry, plus the built-ins.
 *
 * Keyed by host, not merged into one flat list, because a theme registry
 * belongs to the machine that stores it: this device can legitimately know
 * profiles from more than one host (see `syncProfilesForHost`), and two
 * hosts can each have a `nord-ish` that isn't the same file. Resolving a
 * profile's theme always goes through that profile's own host.
 *
 * Persisted so the catalog survives a cold start and an unreachable host —
 * a profile whose theme lives on a host that's currently down should still
 * paint in its theme, not snap back to the built-in.
 */
interface ThemeStore {
  version: 1;
  byHost: Record<string, Theme[]>;
}

const STORAGE_KEY = "anywh:themes";

const EMPTY_STORE: ThemeStore = { version: 1, byHost: {} };

function readStore(): ThemeStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (typeof parsed !== "object" || parsed === null) return EMPTY_STORE;
    const candidate = parsed as ThemeStore;
    if (candidate.version !== 1 || typeof candidate.byHost !== "object" || candidate.byHost === null) {
      return EMPTY_STORE;
    }
    return candidate;
  } catch {
    return EMPTY_STORE;
  }
}

let store: ThemeStore = readStore();
const listeners = new Set<() => void>();

/** Synchronous read — pair with `subscribeThemes` in a `useSyncExternalStore`
 * (see `useThemes`), same shape as `getProfiles`/`subscribeProfiles`. */
export function getThemeStore(): ThemeStore {
  return store;
}

export function subscribeThemes(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Replaces what this device knows about one host's registry — the write
 * side of `useThemeSync`. Never called on a failed fetch: an unreachable
 * host must not look like a host with no themes. `host` here is really a
 * `themeStoreKey` (a profile id for a tailnet profile) — kept as the
 * parameter name since a direct profile's key genuinely is its host. */
export function setThemesForHost(host: string, themes: Theme[]): void {
  const current = store.byHost[host];
  if (current && current.length === themes.length && current.every((theme, i) => theme.id === themes[i].id && theme.updatedAt === themes[i].updatedAt)) {
    return;
  }
  store = { ...store, byHost: { ...store.byHost, [host]: themes } };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  for (const listener of listeners) listener();
}

/** Custom themes registered on `host`. */
export function customThemesForHost(host: string): Theme[] {
  return store.byHost[host] ?? [];
}

/** Everything selectable for a profile on `host`: the built-ins first (they
 * exist even with the relay down), then that host's custom themes. */
export function selectableThemes(host: string): Theme[] {
  return [...BUILTIN_THEMES, ...customThemesForHost(host)];
}

export interface ProfileThemeResolution {
  theme: Theme;
  /** True when the profile points at a theme this device can't find on its
   * host — deleted from another device, or the host hasn't synced yet.
   * The selection is deliberately left alone on the relay (see
   * themeRegistry.ts), so this is a state to report, not to repair. */
  missing: boolean;
}

export function resolveProfileTheme(profile: Profile): ProfileThemeResolution {
  if (!profile.themeId) return { theme: DEFAULT_THEME, missing: false };
  const found = selectableThemes(themeStoreKey(profile)).find((theme) => theme.id === profile.themeId);
  return found ? { theme: found, missing: false } : { theme: DEFAULT_THEME, missing: true };
}

/** Profiles that would lose their theme if `themeId` were deleted from
 * `scopedProfile`'s registry — used to say how many before confirming,
 * without asking the relay (the profile list this device already has
 * carries `themeId`). Compares by `themeStoreKey`, not `host` directly, so
 * two tailnet profiles sharing the placeholder host never get counted as
 * using each other's theme. */
export function profilesUsingTheme(profiles: Profile[], scopedProfile: Profile, themeId: string): Profile[] {
  const key = themeStoreKey(scopedProfile);
  return profiles.filter((profile) => themeStoreKey(profile) === key && profile.themeId === themeId);
}
