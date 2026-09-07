import { useEffect, useState } from "react";
import { fetchControlProfiles } from "@/lib/relayClient";
import { syncProfilesForHost, type Profile } from "@/lib/profiles";

interface ProfileSyncResult {
  /** `false` once a `GET /control/profiles` on this host has failed (404 on
   * an older relay, or any other error) — the host doesn't run the control
   * API, so "Adicionar perfil" stays hidden. Detected at runtime, not
   * cached on the `Profile` itself: a stored flag would go stale the
   * moment the host is upgraded. */
  supported: boolean;
}

/**
 * Keeps the local profile list mirrored to `profile.host`'s
 * `GET /control/profiles` — no manual "Importar" step. A profile created or
 * deleted from any other device shows up (or disappears) here the next time
 * this effect runs, which is on mount and whenever the app regains
 * foreground (`visibilitychange`, same signal `useRelayClient` already uses
 * for reconnection — not the Tauri focus API, which false-positives on iOS).
 *
 * A failed fetch (host unreachable, or an older relay without this route)
 * only flips `supported` to `false` — it deliberately never touches the
 * local list, so a temporarily-unreachable host doesn't make its profiles
 * vanish out from under the user.
 */
export function useProfileSync(profile: Profile): ProfileSyncResult {
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    let cancelled = false;

    function sync(): void {
      fetchControlProfiles(profile.host, profile.relayPort)
        .then((remote) => {
          if (cancelled) return;
          syncProfilesForHost(profile.host, remote);
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
  }, [profile.id, profile.host, profile.relayPort]);

  return { supported };
}
