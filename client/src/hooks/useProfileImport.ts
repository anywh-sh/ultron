import { useEffect, useRef } from "react";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { inTauri } from "@/lib/tauri";
import { importProfile, parseImportProfileUrl } from "@/lib/profileImport";

/**
 * Listens for `ultron://import-profile` deep links (see profileImport.ts
 * for the URL format, src-tauri/tauri.conf.json for the OS-registered
 * scheme) and turns each into a new local profile, handing its id back so
 * the caller can switch to it — same "registration exists, caller decides
 * what to do next" shape as `useNotificationClick`.
 *
 * Two delivery paths, both handled: `getCurrent()` covers a cold launch
 * (the OS started the app *because* of the link — the common case for a
 * pairing flow, since the app usually isn't running yet), `onOpenUrl` covers
 * the link arriving while the app is already open. `onOpenUrl` needs the
 * single-instance plugin to fire at all on Windows/Linux (the OS spawns a
 * second process and hands it the URL as a CLI argument instead of
 * notifying the running one) — now wired up in src-tauri/src/lib.rs with
 * the plugin's `deep-link` feature, so all three desktop platforms deliver
 * both paths.
 *
 * Neither path is the only way in: `AddRemoteMachineDialog` redeems a typed
 * pairing code through the same import, for whoever has a code but no
 * working link (a platform where `ultron://` isn't registered, a browser
 * that swallowed it, a code read off another screen).
 */
export function useProfileImport(onImported: (profileId: string) => void): void {
  const onImportedRef = useRef(onImported);
  onImportedRef.current = onImported;

  useEffect(() => {
    if (!inTauri()) return;

    function handle(urls: string[]): void {
      for (const url of urls) {
        const params = parseImportProfileUrl(url);
        if (!params) {
          console.error(`useProfileImport: ignoring unrecognized deep link: ${url}`);
          continue;
        }
        // journal/62 F4: a tailnet-mode import redeems the join code over
        // the network (claimTailnetBundle) before there's a profile to add
        // at all — no profile (and no `onImported` call) on failure, same
        // as an unrecognized link above.
        importProfile(params)
          .then((id) => onImportedRef.current(id))
          .catch((err: unknown) => {
            console.error(`useProfileImport: failed to import profile from deep link: ${url}`, err);
          });
      }
    }

    // Deferred by a tick, same trick as tailnetSidecar.ts's release delay
    // and useRelayClient.ts's start() — React 18 StrictMode (dev) mounts
    // this effect, cleans it up, and mounts it again, synchronously, within
    // one tick. Calling getCurrent() straight from the effect meant the
    // doomed first mount already redeemed the join code (importProfile →
    // claimTailnetBundle, single-use per code) before its own cleanup had
    // any chance to stop it — the second mount's redemption of the very
    // same code then failed with a 409, on every cold launch. Deferring
    // means the first mount's cleanup clears its timer before it ever
    // fires; only the surviving mount calls getCurrent() and redeems the
    // code, exactly once.
    const initialUrlTimer = setTimeout(() => {
      void getCurrent().then((urls) => {
        if (urls) handle(urls);
      });
    }, 0);

    const unlistenPromise = onOpenUrl(handle);

    return () => {
      clearTimeout(initialUrlTimer);
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);
}
