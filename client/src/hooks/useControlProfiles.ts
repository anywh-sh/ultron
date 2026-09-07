import { useEffect, useState } from "react";
import { fetchControlProfiles } from "@/lib/relayClient";
import { addProfile, getProfiles, type Profile } from "@/lib/profiles";
import type { RemoteProfile } from "@/lib/relay-types";
import { useProfiles } from "@/hooks/useProfiles";

interface ControlProfilesResult {
  /** Profiles this host knows about that this device hasn't added yet —
   * what `AddProfileDialog`'s "Importar" tab lists. */
  importable: RemoteProfile[];
  /** `false` once a `GET /control/profiles` on this host has failed (404 on
   * an older relay, or any other error) — the host doesn't run the control
   * API, so create/import/manage stay hidden. Detected at runtime, not
   * cached on the `Profile` itself: a stored flag would go stale the
   * moment the host is upgraded. */
  supported: boolean;
  loading: boolean;
}

/**
 * Reconciles the locally known profiles for `profile.host` against
 * `GET /control/profiles` on that same host: label/colorIndex there are
 * authoritative (a rename or recolor on one device should show up on every
 * other device that reaches the same host), so a mismatch gets written back
 * via `addProfile` (upsert-by-id).
 *
 * Deliberately does *not* silently add a profile the device has never
 * imported — that's `importable` below and `AddProfileDialog`'s "Importar"
 * tab, one click at a time. Making that automatic would also undo "remove
 * from this device" (docs/45 Fase 6) on its own the next time this effect
 * ran, which defeats the point of that action.
 */
export function useControlProfiles(profile: Profile): ControlProfilesResult {
  const knownProfiles = useProfiles();
  const [remote, setRemote] = useState<RemoteProfile[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchControlProfiles(profile.host, profile.relayPort)
      .then((list) => {
        if (!cancelled) setRemote(list);
      })
      .catch(() => {
        if (!cancelled) setRemote(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profile.id, profile.host, profile.relayPort]);

  useEffect(() => {
    if (!remote) return;
    for (const entry of remote) {
      const local = getProfiles().find((p) => p.id === entry.id && p.host === profile.host);
      if (local && (local.label !== entry.label || local.colorIndex !== entry.colorIndex)) {
        addProfile({ ...local, label: entry.label, colorIndex: entry.colorIndex });
      }
    }
    // Runs once per fetch, not on every render — `getProfiles()`/`addProfile`
    // are read/written directly instead of through `knownProfiles` so this
    // effect doesn't need it as a dependency (which would re-run it every
    // time `addProfile` itself fires, including for the sync it just did).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote, profile.host]);

  const importable = (remote ?? []).filter(
    (entry) => !knownProfiles.some((p) => p.id === entry.id && p.host === profile.host),
  );

  return { importable, supported: remote !== null, loading };
}
