/**
 * Tracks which profiles' connections have been permanently revoked
 * (`BrokerRevokedError` — a 410 from the broker) — a small, module-level
 * store in the same shape as `profiles.ts`'s own (`getProfiles`/
 * `subscribeProfiles`), since this needs the same "read outside React,
 * subscribe from a hook" access every one of the four independent
 * reconnect loops (chat, sessions/watch, terminal, files) can reach.
 *
 * Deliberately in-memory only, never persisted — a profile marked here
 * stays revoked only for the life of this app run; removing the profile
 * (the action the banner offers) is what actually resolves it, not
 * clearing this flag on its own.
 */
const revokedProfileIds = new Set<string>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function markProfileRevoked(profileId: string): void {
  if (revokedProfileIds.has(profileId)) return;
  revokedProfileIds.add(profileId);
  notify();
}

/** Called after the profile is removed (or the banner is dismissed) so a
 * profile id can be reused (e.g. re-paired later) without carrying a stale
 * revoked flag. */
export function clearProfileRevoked(profileId: string): void {
  if (!revokedProfileIds.has(profileId)) return;
  revokedProfileIds.delete(profileId);
  notify();
}

export function isProfileRevoked(profileId: string): boolean {
  return revokedProfileIds.has(profileId);
}

export function subscribeProfileRevocation(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
