import { useCallback, useRef, useState } from "react";
import { fetchControlProfiles } from "@/lib/relayClient";
import { useForegroundSync } from "@/hooks/useForegroundSync";
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
 * `GET /control/profiles` — no manual "Importar" step. A profile created,
 * deleted, renamed or re-themed from any other device shows up here on the
 * triggers `useForegroundSync` provides.
 *
 * Call this once, high in the tree (`App`), never from a component that can
 * unmount: it used to live in `ProfileSwitcher`, which is inside the
 * collapsible sidebar and absent entirely on iOS, so collapsing the sidebar
 * silently turned the sync off and the phone never ran it at all. That was
 * invisible while profiles rarely changed, and became obvious once the
 * theme started riding along on this same payload.
 *
 * A failed fetch (host unreachable, or an older relay without this route)
 * only flips `supported` to `false` — it deliberately never touches the
 * local list, so a temporarily-unreachable host doesn't make its profiles
 * vanish out from under the user.
 */
export function useProfileSync(profile: Profile): ProfileSyncResult {
  const [supported, setSupported] = useState(true);
  // Guards against a response from the previous host landing after a
  // profile switch — the effect identity no longer changes per fetch now
  // that the triggers live outside it.
  const currentHost = useRef(profile.host);
  currentHost.current = profile.host;

  const sync = useCallback(() => {
    const host = profile.host;
    fetchControlProfiles(host, profile.relayPort)
      .then((remote) => {
        if (currentHost.current !== host) return;
        syncProfilesForHost(host, remote);
        setSupported(true);
      })
      .catch(() => {
        if (currentHost.current === host) setSupported(false);
      });
  }, [profile.host, profile.relayPort]);

  useForegroundSync(sync);

  return { supported };
}
