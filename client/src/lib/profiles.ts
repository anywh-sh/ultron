export interface Profile {
  id: string;
  label: string;
  host: string;
  relayPort: number;
}

const STORAGE_KEY = "ultron:profiles";

// Seed data — the only two profiles this deployment has ever had, kept here
// so a fresh install still works with zero setup. A future pairing flow (or
// a settings UI) can call `setProfiles` to replace/extend this list at
// runtime; every consumer already reads through `getProfiles`/`useProfiles`,
// so none of them need to change again when that flow shows up.
const DEFAULT_PROFILES: Profile[] = [
  { id: "pessoal", label: "Pessoal", host: "100.64.0.1", relayPort: 8765 },
  { id: "trabalho", label: "Trabalho", host: "100.64.0.1", relayPort: 8766 },
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
