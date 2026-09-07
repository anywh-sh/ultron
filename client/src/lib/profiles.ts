import type { RemoteProfile } from "@/lib/relay-types";

export interface Profile {
  /** Immutable slug — the key of every per-profile storage (tabs, recent
   * folders, settings) and of the host-side artifacts (`<id>.env`,
   * `ultron-relay@<id>`, sessions file). Generated once at creation from the
   * label and never rewritten: renaming a profile must not orphan its
   * settings. */
  id: string;
  /** Free text, user-editable, UI only. */
  label: string;
  host: string;
  relayPort: number;
  /** Index into the profile color palette (index.css), allocated against the
   * whole list at creation time. Absent on profiles created before this
   * field existed — fall back to the position in the list. */
  colorIndex?: number;
}

const STORAGE_KEY = "ultron:profiles";

// Seed data, built from build-time env vars (see client/.env.example) so a
// distributed binary doesn't hardcode any one deployment's address. A future
// pairing flow (or a settings UI) can call `setProfiles` to replace/extend
// this list at runtime; every consumer already reads through
// `getProfiles`/`useProfiles`, so none of them need to change again when
// that flow shows up.
const DEFAULT_PROFILES: Profile[] = [
  {
    id: "default",
    label: "Default",
    host: import.meta.env.VITE_ULTRON_HOST ?? "127.0.0.1",
    relayPort: Number(import.meta.env.VITE_ULTRON_PORT ?? 8765),
  },
];

function isProfile(value: unknown): value is Profile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.label === "string" &&
    typeof candidate.host === "string" &&
    typeof candidate.relayPort === "number"
  );
}

function readStoredProfiles(): Profile[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_PROFILES;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 && parsed.every(isProfile) ? parsed : DEFAULT_PROFILES;
  } catch {
    return DEFAULT_PROFILES;
  }
}

let profiles: Profile[] = readStoredProfiles();
const listeners = new Set<() => void>();

/** Synchronous read of the current list — for call sites that aren't React
 * components (event handlers, one-off migrations) and don't need to
 * re-render when it changes. Components that render the list itself should
 * use `useProfiles` (hooks/useProfiles.ts) instead. */
export function getProfiles(): Profile[] {
  return profiles;
}

/** Replaces the whole list and persists it — the write side of the dynamic
 * profiles store. Nothing calls this yet (still seeded from
 * `DEFAULT_PROFILES` only), but it exists now so the pairing/settings flow
 * that will call it doesn't need every consumer touched again. */
export function setProfiles(next: Profile[]): void {
  profiles = next;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  for (const listener of listeners) listener();
}

export function subscribeProfiles(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function findProfile(id: string): Profile | undefined {
  return profiles.find((profile) => profile.id === id);
}

/** Appends a profile, or replaces the entry with the same id (the host
 * registry is authoritative for label/color, so re-adding is an update). */
export function addProfile(profile: Profile): void {
  setProfiles([...profiles.filter((p) => p.id !== profile.id), profile]);
}

/** Refuses to empty the list: `readStoredProfiles` falls back to
 * `DEFAULT_PROFILES` on an empty array, so removing the last profile would
 * silently resurrect the seeded one instead of leaving the app profileless. */
export function removeProfile(id: string): boolean {
  if (profiles.length <= 1) return false;
  setProfiles(profiles.filter((p) => p.id !== id));
  return true;
}

/** Mirrors `host`'s `GET /control/profiles` onto the local list — the only
 * write path now that profiles are auto-synced instead of manually
 * imported (see `useProfileSync`). Replaces entries for `host`, plus any
 * local entry whose `id` also appears in `remote` regardless of the host it
 * was previously stored under — a profile's own advertised `host` (each
 * entry's `RELAY_HOST`, read server-side) can legitimately differ from the
 * host this device dialed to reach it (e.g. an `ensureSelfRegistered`
 * `"default"` self-registration reports `127.0.0.1` while the machine's
 * real profiles report a Tailscale IP). Deduping only by host let a stale
 * `"default"` row survive every sync against a differently-hosted profile,
 * and a fresh one from `remote` got appended alongside it each time —
 * duplicate rows for the same id piling up in the switcher. A device can
 * still know profiles from more than one host at once (`DangerZone`'s
 * executor lookup already assumes this); only ids present in `remote` are
 * touched. Guards against ever emptying the list (same reasoning as
 * `removeProfile` above) — a transient empty response shouldn't wipe out
 * every profile this device knows about. */
export function syncProfilesForHost(host: string, remote: RemoteProfile[]): void {
  const remoteIds = new Set(remote.map((entry) => entry.id));
  const merged = [
    ...profiles.filter((p) => p.host !== host && !remoteIds.has(p.id)),
    ...remote.map((entry) => ({
      id: entry.id,
      label: entry.label,
      host: entry.host,
      relayPort: entry.port,
      colorIndex: entry.colorIndex,
    })),
  ];
  if (merged.length === 0) return;
  setProfiles(merged);
}

const PROFILE_COLOR_CLASSES = [
  "bg-profile-1", "bg-profile-2", "bg-profile-3",
  "bg-profile-4", "bg-profile-5", "bg-profile-6",
];

/** Size of the palette — for a color picker (`SettingsDialog`) to iterate
 * over every swatch without duplicating the count. */
export const PROFILE_COLOR_COUNT = PROFILE_COLOR_CLASSES.length;

/** Raw index → color class — the color picker in `SettingsDialog` renders
 * every swatch by index directly, without going through a `Profile` at all. */
export function profileColorClassForIndex(index: number): string {
  return PROFILE_COLOR_CLASSES[index % PROFILE_COLOR_CLASSES.length];
}

/** Stable color for a profile's dot. Reads the index allocated at creation
 * time; falls back to the position in the list for profiles stored before
 * `colorIndex` existed (the two seeded ones keep their current colors that
 * way, since `pessoal` is first and `trabalho` second). */
export function profileColorClass(profileId: string): string {
  const index = profiles.findIndex((p) => p.id === profileId);
  const profile = index >= 0 ? profiles[index] : undefined;
  const slot = profile?.colorIndex ?? (index >= 0 ? index : 0);
  return profileColorClassForIndex(slot);
}
