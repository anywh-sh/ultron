export interface Profile {
  id: string;
  label: string;
  host: string;
  relayPort: number;
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
