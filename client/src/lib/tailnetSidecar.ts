import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "@/lib/tauri";
import type { Profile } from "@/lib/profiles";

export interface TailnetEndpoint {
  host: string;
  port: number;
}

interface Entry {
  refCount: number;
  endpoint: Promise<TailnetEndpoint>;
}

const entries = new Map<string, Entry>();

function parseAddr(addr: string): TailnetEndpoint {
  const separator = addr.lastIndexOf(":");
  return { host: addr.slice(0, separator), port: Number(addr.slice(separator + 1)) };
}

/** Starts (or joins an already-starting/started) tailnet-sidecar for
 * `profile.id`, ref-counted so every tab open on the same tailnet profile
 * shares one tsnet join and one local port (journal/62 F2) — mirrors the
 * dedup `tailnet_sidecar_start` (Rust) already does on its own side.
 * Callers await the same promise, so a tab that mounts while the first is
 * still joining gets the same eventual endpoint (or the same rejection)
 * instead of racing a second join. Must be paired with exactly one
 * `releaseTailnetSidecar(profile.id)` call, even if this promise rejects —
 * that's what lets a failed join be retried by the next caller instead of
 * being stuck forever on a cached rejection.
 *
 * `target` (`host:port` inside the tailnet to dial) only matters for
 * whichever call actually starts the join — a tab that finds one already
 * running (journal/62 F3: e.g. a second tab on a brokered profile, which
 * resolves its own target fresh from the broker every time) just gets that
 * one's address regardless of what it passed. The sidecar only re-resolves
 * a new target on the next *cold* start, once every tab has released it. */
export function acquireTailnetSidecar(profile: Profile, target: string): Promise<TailnetEndpoint> {
  const existing = entries.get(profile.id);
  if (existing) {
    existing.refCount += 1;
    return existing.endpoint;
  }
  const endpoint = inTauri()
    ? invoke<string>("tailnet_sidecar_start", {
        profileId: profile.id,
        authKey: profile.tailnetAuthKey,
        controlUrl: profile.tailnetControlUrl,
        target,
      }).then(parseAddr)
    : Promise.reject(new Error("tailnet mode needs the Tauri sidecar, not available in a plain browser"));
  entries.set(profile.id, { refCount: 1, endpoint });
  return endpoint;
}

/** Releases one reference acquired via `acquireTailnetSidecar` — once the
 * last tab on a profile releases it, the sidecar is actually stopped. Safe
 * to call for a profile that was never acquired (a no-op) — e.g. cleanup
 * running for a tab that switched profile before its first render. */
export function releaseTailnetSidecar(profileId: string): void {
  const entry = entries.get(profileId);
  if (!entry) return;
  entry.refCount -= 1;
  if (entry.refCount > 0) return;
  entries.delete(profileId);
  // Fire-and-forget: nothing downstream needs to await the child actually
  // dying, and outside Tauri there's nothing to stop in the first place.
  if (inTauri()) void invoke("tailnet_sidecar_stop", { profileId });
}
